import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import YAML from 'yaml'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { createCapabilityContext } from '../../../../core/capability/context.js'
import { runCapability } from '../../../../core/capability/runner.js'
import { createRoutingDecision, escalateRoutingDecision, getEscalationReason, isRoutingEnabled } from '../../../routing/index.js'
import { discussCapability } from '../../../discuss/index.js'
import { loopCapability } from '../../../loop/index.js'
import type { LoopExecutionResult, LoopPreparedInput, LoopSummaryOutput } from '../../../loop/types.js'
import { unitTestEvalCapability } from '../../../quality/unit-test-eval/index.js'
import { reviewCapability } from '../../../review/index.js'
import { extractJsonBlock } from '../../../../trd/renderer.js'
import { issueFixCapability } from '../../issue-fix/index.js'
import {
  appendWorkflowEvent,
  generateWorkflowId,
  loadWorkflowSession,
  persistWorkflowSession,
  sessionDirFor,
} from '../../shared/runtime.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import type { MagpieConfigV2, ModelRouteBinding, RoutingDecision } from '../../../../platform/config/types.js'
import { createConfiguredProvider } from '../../../../platform/providers/index.js'
import type { MergedIssue } from '../../../../core/debate/types.js'
import type {
  HarnessCycle,
  HarnessPreparedInput,
  HarnessResult,
  HarnessStage,
  HarnessValidatorCheckArtifact,
} from '../types.js'
import { selectHarnessProviders } from './provider-selection.js'
import { getHarnessProgressObserver } from '../progress.js'
import { createNotificationRouter } from '../../../../platform/integrations/notifications/factory.js'
import { dispatchStageNotification } from '../../../../platform/integrations/notifications/stage-dispatch.js'
import {
  createTaskKnowledge,
  promoteKnowledgeCandidates,
  updateTaskKnowledgeState,
  updateTaskKnowledgeSummary,
  writeTaskKnowledgeFinal,
  type KnowledgeCandidate,
} from '../../../../knowledge/runtime.js'

const BLOCKING_SEVERITIES = new Set(['critical', 'high'])
const HARNESS_REVIEWER_PROMPTS = [
  'You are a strict release gate reviewer. Prioritize correctness, security, and missing tests. Focus on blocking risks first.',
  'You are an adversarial implementation reviewer. Challenge weak claims, look for hidden failure modes, and verify that fixes really address the reported issue.',
  'You are a systems reviewer. Focus on architecture drift, rollout safety, compatibility, and cross-module regressions.',
]
const DEFAULT_HARNESS_VALIDATOR_BINDINGS: ModelRouteBinding[] = [
  { tool: 'claw' },
  { tool: 'kiro' },
]

interface DecisionJson {
  decision?: 'approved' | 'revise'
  rationale?: string
  requiredActions?: string[]
}

interface HarnessValidatorJson {
  decision?: 'approved' | 'revise'
  rationale?: string
  unresolvedItems?: string[]
}

interface HarnessValidatorResult {
  id: string
  label: string
  tool?: string
  model?: string
  agent?: string
  outputPath: string
  decision: 'approved' | 'revise' | 'unknown'
  rationale: string
  unresolvedItems: string[]
}

interface HarnessResumeState {
  isResume: boolean
  shouldResumeLoop: boolean
  canReuseCompletedDevelopment: boolean
  completedCycles: HarnessCycle[]
  approvedFromCompletedCycles: boolean
}

interface PersistedHarnessResumeEvidence {
  input: {
    goal: string
    prdPath: string
    maxCycles?: number
    reviewRounds?: number
    testCommand?: string
    models?: string[]
    complexity?: HarnessPreparedInput['complexity']
    host?: HarnessPreparedInput['host']
    priority?: HarnessPreparedInput['priority']
  }
  configPath?: string
  runtime?: {
    retryCount?: number
    nextRetryAt?: string
    lastError?: string
    lastReliablePoint?: string
  }
}

function describeHarnessActor(
  binding: { tool?: string; model?: string; agent?: string },
  fallbackId: string,
  role: string
): { id: string; role: string } {
  return {
    id: binding.agent || binding.model || binding.tool || fallbackId,
    role,
  }
}

function buildHarnessAiRoster(
  config: MagpieConfigV2,
  reviewerIds: string[],
  stage: HarnessStage
): Array<{ id: string; role: string }> {
  if (stage === 'reviewing' || stage === 'completed' || stage === 'failed') {
    const reviewers = reviewerIds
      .map((reviewerId) => {
        const reviewer = config.reviewers?.[reviewerId]
        if (!reviewer) return null
        return {
          id: reviewer.agent || reviewer.model || reviewer.tool || reviewerId,
          role: reviewerId === reviewerIds[0]
            ? '负责主审和结论收敛'
            : reviewerId === reviewerIds[reviewerIds.length - 1]
              ? '负责风险挑战和系统性复核'
              : '负责补充交叉评审意见',
        }
      })
      .filter((item): item is { id: string; role: string } => item !== null)
    const validators = resolveHarnessValidatorBindings(config).map((binding) => ({
      id: describeBindingLabel(binding),
      role: '负责附加交叉检查和完成度复核',
    }))

    if (reviewers.length > 0 || validators.length > 0) {
      return [...reviewers, ...validators]
    }
  }

  return [
    describeHarnessActor({
      tool: config.capabilities.loop?.planner_tool,
      model: config.capabilities.loop?.planner_model,
      agent: config.capabilities.loop?.planner_agent,
    }, 'loop-planner', '负责开发阶段规划、判断和推进策略'),
    describeHarnessActor({
      tool: config.capabilities.loop?.executor_tool,
      model: config.capabilities.loop?.executor_model,
      agent: config.capabilities.loop?.executor_agent,
    }, 'loop-executor', '负责开发阶段的实际执行与改动落地'),
  ]
}

function describeBindingLabel(binding: ModelRouteBinding | undefined, fallback = 'validator'): string {
  if (!binding) return fallback
  const primary = binding.tool || binding.model || fallback
  return binding.agent ? `${primary}:${binding.agent}` : primary
}

function slugifyBindingLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'validator'
}

function toValidatorArtifact(validation: HarnessValidatorResult): HarnessValidatorCheckArtifact {
  return {
    id: validation.id,
    label: validation.label,
    tool: validation.tool,
    model: validation.model,
    agent: validation.agent,
    outputPath: validation.outputPath,
  }
}

function legacyValidatorArtifacts(cycle: Partial<HarnessCycle> & {
  clawCheckPath?: string
  kiroCheckPath?: string
}): HarnessValidatorCheckArtifact[] {
  const artifacts: HarnessValidatorCheckArtifact[] = []
  if (cycle.clawCheckPath) {
    artifacts.push({ id: 'claw', label: 'claw', tool: 'claw', outputPath: cycle.clawCheckPath })
  }
  if (cycle.kiroCheckPath) {
    artifacts.push({ id: 'kiro', label: 'kiro', tool: 'kiro', outputPath: cycle.kiroCheckPath })
  }
  return artifacts
}

function normalizePersistedHarnessCycle(raw: unknown): HarnessCycle | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const cycle = raw as Partial<HarnessCycle> & {
    clawCheckPath?: string
    kiroCheckPath?: string
  }
  return {
    ...(cycle as HarnessCycle),
    validatorChecks: Array.isArray(cycle.validatorChecks)
      ? cycle.validatorChecks
      : legacyValidatorArtifacts(cycle),
  }
}

async function loadPersistedHarnessCycles(roundsPath: string): Promise<HarnessCycle[]> {
  try {
    const raw = await readFile(roundsPath, 'utf-8')
    const data = JSON.parse(raw) as unknown[]
    return Array.isArray(data)
      ? data.map(normalizePersistedHarnessCycle).filter((cycle): cycle is HarnessCycle => cycle !== null)
      : []
  } catch {
    return []
  }
}

function cycleApproved(cycle: HarnessCycle | undefined): boolean {
  if (!cycle) {
    return false
  }
  return cycle.testsPassed
    && cycle.blockingIssueCount === 0
    && cycle.modelDecision === 'approved'
}

function resolveHarnessResumeState(
  existingSession: Awaited<ReturnType<typeof loadWorkflowSession>>,
  completedCycles: HarnessCycle[]
): HarnessResumeState {
  if (!existingSession) {
    return {
      isResume: false,
      shouldResumeLoop: false,
      canReuseCompletedDevelopment: false,
      completedCycles,
      approvedFromCompletedCycles: false,
    }
  }

  const hasLoopSession = Boolean(existingSession.artifacts.loopSessionId)
  const canReuseCompletedDevelopment = hasLoopSession
    && (existingSession.currentStage === 'reviewing'
      || existingSession.currentStage === 'completed'
      || existingSession.currentStage === 'failed'
      || completedCycles.length > 0)
  const shouldResumeLoop = hasLoopSession
    && !canReuseCompletedDevelopment
    && existingSession.currentStage === 'developing'
  const isResume = existingSession.status === 'waiting_next_cycle'
    || existingSession.status === 'blocked'
    || existingSession.status === 'waiting_retry'
    || canReuseCompletedDevelopment
    || shouldResumeLoop

  return {
    isResume,
    shouldResumeLoop,
    canReuseCompletedDevelopment,
    completedCycles,
    approvedFromCompletedCycles: cycleApproved(completedCycles[completedCycles.length - 1]),
  }
}

function nextHarnessAction(stage: HarnessStage, cycle?: number): string {
  switch (stage) {
    case 'queued':
      return '选择本轮可用模型并进入开发阶段。'
    case 'developing':
      return '运行 loop 开发阶段并等待产出。'
    case 'reviewing':
      return cycle ? `运行第 ${cycle} 轮评审并决定是否继续修复。` : '运行评审并决定是否继续修复。'
    case 'completed':
      return '本次 harness 已完成，无后续动作。'
    case 'failed':
      return '检查失败原因并决定是否重试。'
  }
}

function buildHarnessPlanSummary(goal: string): string {
  return [
    '# Plan',
    '',
    `Goal: ${goal}`,
    '',
    '- Run loop development first.',
    '- Run adversarial review, adjudication, and unit test evaluation per cycle.',
    '- Stop when reviewers approve and tests pass, otherwise auto-fix and continue.',
  ].join('\n')
}

function buildHarnessCycleSummary(cycle: HarnessCycle): string {
  const validatorArtifacts = cycle.validatorChecks.length > 0
    ? cycle.validatorChecks.map((validation) => `- ${validation.label}: ${validation.outputPath}`)
    : ['- none']
  return [
    `# Cycle ${cycle.cycle}`,
    '',
    `Issue count: ${cycle.issueCount}`,
    `Blocking issues: ${cycle.blockingIssueCount}`,
    `Tests passed: ${cycle.testsPassed ? 'yes' : 'no'}`,
    `Decision: ${cycle.modelDecision}`,
    '',
    cycle.modelRationale,
    '',
    'Artifacts:',
    `- Review: ${cycle.reviewOutputPath}`,
    ...validatorArtifacts,
    `- Adjudication: ${cycle.adjudicationOutputPath}`,
    `- Unit test eval: ${cycle.unitTestEvalPath}`,
    ...(cycle.issueFixSessionId ? [`- Issue fix session: ${cycle.issueFixSessionId}`] : []),
  ].join('\n')
}

function buildHarnessOpenIssues(cycle: HarnessCycle): string {
  if (cycle.blockingIssueCount === 0 && cycle.testsPassed) {
    return '# Open Issues\n\n- None.\n'
  }

  return [
    '# Open Issues',
    '',
    cycle.blockingIssueCount > 0
      ? `- ${cycle.blockingIssueCount} blocking review issue(s) still need attention.`
      : '- Review blockers cleared.',
    cycle.testsPassed
      ? '- Test gate is passing.'
      : '- Unit tests are still failing or did not complete cleanly.',
    cycle.modelDecision === 'approved'
      ? '- Model gate approved the change.'
      : '- Model gate still requests revision.',
  ].join('\n')
}

function buildHarnessEvidence(cycle: HarnessCycle): string {
  const validatorArtifacts = cycle.validatorChecks.length > 0
    ? cycle.validatorChecks.map((validation) => `- ${validation.label}: ${validation.outputPath}`)
    : ['- Validator checks: none']
  return [
    '# Evidence',
    '',
    `- Review output: ${cycle.reviewOutputPath}`,
    ...validatorArtifacts,
    `- Adjudication output: ${cycle.adjudicationOutputPath}`,
    `- Unit test evaluation: ${cycle.unitTestEvalPath}`,
  ].join('\n')
}

function buildHarnessCandidates(
  goal: string,
  sessionId: string,
  approved: boolean,
  summary: string,
  evidencePath: string
): KnowledgeCandidate[] {
  if (approved) {
    return [{
      type: 'decision',
      title: goal,
      summary,
      sourceSessionId: sessionId,
      evidencePath,
      status: 'candidate',
    }]
  }

  return [{
    type: 'failure-pattern',
    title: summary,
    summary,
    sourceSessionId: sessionId,
    evidencePath,
    status: 'candidate',
  }]
}

function buildPersistedHarnessResumeEvidence(
  prepared: HarnessPreparedInput,
  configPath: string | undefined,
  existingEvidence: unknown
): PersistedHarnessResumeEvidence {
  const evidence = (existingEvidence && typeof existingEvidence === 'object'
    ? existingEvidence
    : {}) as Partial<PersistedHarnessResumeEvidence>

  return {
    ...evidence,
    input: {
      goal: prepared.goal,
      prdPath: prepared.prdPath,
      ...(Number.isFinite(prepared.maxCycles) ? { maxCycles: prepared.maxCycles } : {}),
      ...(Number.isFinite(prepared.reviewRounds) ? { reviewRounds: prepared.reviewRounds } : {}),
      ...(prepared.testCommand ? { testCommand: prepared.testCommand } : {}),
      ...(prepared.models.length > 0 ? { models: prepared.models } : {}),
      ...(prepared.complexity ? { complexity: prepared.complexity } : {}),
      ...(prepared.host ? { host: prepared.host } : {}),
      ...(prepared.priority ? { priority: prepared.priority } : {}),
    },
    ...(configPath ? { configPath } : {}),
    runtime: {
      retryCount: Number.isFinite(evidence.runtime?.retryCount) ? Number(evidence.runtime?.retryCount) : 0,
      ...(typeof evidence.runtime?.nextRetryAt === 'string' ? { nextRetryAt: evidence.runtime.nextRetryAt } : {}),
      ...(typeof evidence.runtime?.lastError === 'string' ? { lastError: evidence.runtime.lastError } : {}),
      lastReliablePoint: evidence.runtime?.lastReliablePoint || 'queued',
    },
  }
}

function cloneConfig(config: MagpieConfigV2): MagpieConfigV2 {
  return JSON.parse(JSON.stringify(config)) as MagpieConfigV2
}

function resolveHarnessDefaultReviewers(config: MagpieConfigV2): string[] | null {
  const reviewerIds = config.capabilities.harness?.default_reviewers
  return Array.isArray(reviewerIds) && reviewerIds.length > 0 ? [...reviewerIds] : null
}

function resolveHarnessValidatorBindings(config: MagpieConfigV2): ModelRouteBinding[] {
  const bindings = config.capabilities.harness?.validator_checks
  if (Array.isArray(bindings)) {
    return bindings.map((binding) => ({
      tool: binding.tool,
      model: binding.model,
      agent: binding.agent,
    }))
  }
  return DEFAULT_HARNESS_VALIDATOR_BINDINGS.map((binding) => ({ ...binding }))
}

function ensureHarnessReviewers(config: MagpieConfigV2, models: string[]): string[] {
  const reviewerIds: string[] = []
  const reviewers = config.reviewers || {}

  models.forEach((model, index) => {
    const reviewerId = `harness-${index + 1}`
    reviewers[reviewerId] = {
      model,
      prompt: HARNESS_REVIEWER_PROMPTS[index] || HARNESS_REVIEWER_PROMPTS[HARNESS_REVIEWER_PROMPTS.length - 1],
    }
    reviewerIds.push(reviewerId)
  })

  config.reviewers = reviewers
  config.summarizer = {
    ...config.summarizer,
    model: models[0],
  }
  config.analyzer = {
    ...config.analyzer,
    model: models[Math.min(1, models.length - 1)] || models[0],
  }

  return reviewerIds
}

function applyHarnessReviewerPrompts(config: MagpieConfigV2, reviewerIds: string[]): void {
  const reviewers = config.reviewers || {}

  reviewerIds.forEach((reviewerId, index) => {
    const reviewer = reviewers[reviewerId]
    if (!reviewer) return
    reviewer.prompt = HARNESS_REVIEWER_PROMPTS[index] || HARNESS_REVIEWER_PROMPTS[HARNESS_REVIEWER_PROMPTS.length - 1]
  })

  config.reviewers = reviewers
}

function applyBinding(
  config: MagpieConfigV2,
  target: 'loop' | 'issue_fix',
  planner: ModelRouteBinding,
  execution: ModelRouteBinding
): void {
  const current = config.capabilities[target] || {}
  const next = {
    ...current,
    planner_tool: planner.tool,
    planner_model: planner.model || planner.tool,
    executor_tool: execution.tool,
    executor_model: execution.model || execution.tool,
  }
  if (planner.agent) {
    next.planner_agent = planner.agent
  } else {
    delete next.planner_agent
  }
  if (execution.agent) {
    next.executor_agent = execution.agent
  } else {
    delete next.executor_agent
  }
  config.capabilities[target] = next
}

function alignSummaryRoles(config: MagpieConfigV2, reviewerIds: string[]): void {
  const first = reviewerIds[0]
  const last = reviewerIds[reviewerIds.length - 1] || first
  if (first && config.reviewers[first]) {
    config.summarizer = {
      ...config.summarizer,
      tool: config.reviewers[first].tool,
      model: config.reviewers[first].model,
      agent: config.reviewers[first].agent,
    }
  }
  if (last && config.reviewers[last]) {
    config.analyzer = {
      ...config.analyzer,
      tool: config.reviewers[last].tool,
      model: config.reviewers[last].model,
      agent: config.reviewers[last].agent,
    }
  }
}

function applyHarnessConfigOverrides(
  baseConfig: MagpieConfigV2,
  models: string[],
  modelsExplicit: boolean,
  routingDecision?: RoutingDecision
): { config: MagpieConfigV2; reviewerIds: string[] } {
  const config = cloneConfig(baseConfig)
  const routingReviewerIds = routingDecision?.reviewerIds ? [...routingDecision.reviewerIds] : null
  const configuredDefaultReviewerIds = !modelsExplicit && !routingReviewerIds
    ? resolveHarnessDefaultReviewers(config)
    : null
  const reviewerIds = modelsExplicit
    ? ensureHarnessReviewers(config, models)
    : routingReviewerIds
      || configuredDefaultReviewerIds
      || ensureHarnessReviewers(config, models)

  if (routingReviewerIds) {
    applyHarnessReviewerPrompts(config, reviewerIds)
  }
  if (!modelsExplicit) {
    alignSummaryRoles(config, reviewerIds)
  }

  const loopConfig = config.capabilities.loop || {}
  config.capabilities.loop = {
    ...loopConfig,
    human_confirmation: {
      ...(loopConfig.human_confirmation || {}),
      gate_policy: 'manual_only',
    },
  }

  if (routingDecision) {
    applyBinding(config, 'loop', routingDecision.planning, routingDecision.execution)
    applyBinding(config, 'issue_fix', routingDecision.planning, routingDecision.execution)
  } else if (modelsExplicit) {
    const issueFixConfig = config.capabilities.issue_fix || {}
    config.capabilities.issue_fix = {
      ...issueFixConfig,
      planner_model: models[0],
      executor_model: models[Math.min(1, models.length - 1)] || models[0],
    }
  }

  return { config, reviewerIds }
}

function buildAdjudicationTopic(
  cycle: number,
  issues: MergedIssue[],
  validations: HarnessValidatorResult[],
  testsPassed: boolean,
  testOutput: string
): string {
  const topIssues = issues.slice(0, 10).map((issue, index) => {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
    return `${index + 1}. [${issue.severity}] ${issue.title} @ ${location}\n${issue.description}`
  }).join('\n\n')

  const validationSummary = validations.map((validation) => [
    `Validator: ${validation.label}`,
    `Decision: ${validation.decision}`,
    `Rationale: ${validation.rationale}`,
    `Unresolved: ${validation.unresolvedItems.length > 0 ? validation.unresolvedItems.join('; ') : 'none'}`,
  ].join('\n')).join('\n\n')

  return [
    `Harness adjudication cycle ${cycle}.`,
    '',
    `Unit tests passed: ${testsPassed ? 'yes' : 'no'}`,
    '',
    'Blocking findings from adversarial review:',
    topIssues || '- none',
    '',
    'Validator findings:',
    validationSummary || '- none',
    '',
    'Test output excerpt:',
    testOutput.slice(0, 2000) || '(empty)',
    '',
    'Return ONLY JSON:',
    '```json',
    '{',
    '  "decision": "approved|revise",',
    '  "rationale": "one paragraph",',
    '  "requiredActions": ["..."]',
    '}',
    '```',
    '',
    'Rules:',
    '- decision=approved only if no blocking findings and tests pass.',
    '- Otherwise decision=revise and list concrete actions.',
  ].join('\n')
}

function buildIssueFixPrompt(
  cycle: number,
  issues: MergedIssue[],
  validations: HarnessValidatorResult[],
  testOutput: string,
  decision: DecisionJson | null
): string {
  const issueLines = issues.slice(0, 10).map((issue, index) => {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
    return `${index + 1}. [${issue.severity}] ${issue.title} @ ${location}\n${issue.description}`
  }).join('\n\n')

  const actions = (decision?.requiredActions || []).map((item, index) => `${index + 1}. ${item}`).join('\n')
  const validationLines = validations.map((validation) => {
    const unresolved = validation.unresolvedItems.length > 0
      ? validation.unresolvedItems.map((item, index) => `  ${index + 1}. ${item}`).join('\n')
      : '  - none'
    return `${validation.label}:\n${unresolved}`
  }).join('\n\n')

  return [
    `Harness auto-fix cycle ${cycle}.`,
    '',
    'Please apply the minimum safe changes to resolve these blocking items.',
    '',
    'Blocking items:',
    issueLines || '- none',
    '',
    'Validator unresolved items:',
    validationLines || '- none',
    '',
    'Model adjudication rationale:',
    decision?.rationale || '(none)',
    '',
    'Required actions:',
    actions || '- Resolve blocking review findings and failing tests',
    '',
    'Test output:',
    testOutput.slice(0, 4000) || '(empty)',
  ].join('\n')
}

function toDecision(content: string): DecisionJson | null {
  return extractJsonBlock<DecisionJson>(content)
}

function toValidatorDecision(content: string): HarnessValidatorJson | null {
  return extractJsonBlock<HarnessValidatorJson>(content)
}

function formatValidatorPrompt(
  validatorLabel: string,
  cycle: number,
  issues: MergedIssue[],
  testsPassed: boolean,
  testOutput: string
): string {
  const topIssues = issues.slice(0, 10).map((issue, index) => {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
    return `${index + 1}. [${issue.severity}] ${issue.title} @ ${location}\n${issue.description}`
  }).join('\n\n')

  return [
    `Harness validator ${validatorLabel} cycle ${cycle}.`,
    '',
    `Unit tests passed: ${testsPassed ? 'yes' : 'no'}`,
    '',
    'Review blockers:',
    topIssues || '- none',
    '',
    'Test output excerpt:',
    testOutput.slice(0, 2000) || '(empty)',
    '',
    'Return ONLY JSON:',
    '```json',
    '{',
    '  "decision": "approved|revise",',
    '  "rationale": "one paragraph",',
    '  "unresolvedItems": ["..."]',
    '}',
    '```',
    '',
    'Rules:',
    '- Use decision=approved only when there are no unresolved release blockers from your perspective.',
    '- Otherwise return decision=revise and list concrete unresolvedItems.',
  ].join('\n')
}

async function runValidatorCheck(
  binding: ModelRouteBinding,
  index: number,
  cwd: string,
  config: MagpieConfigV2,
  cycle: number,
  issues: MergedIssue[],
  testsPassed: boolean,
  testOutput: string,
  outputPath: string
): Promise<HarnessValidatorResult> {
  const label = describeBindingLabel(binding)
  const id = `${index + 1}-${slugifyBindingLabel(label)}`
  try {
    const provider = createConfiguredProvider({
      logicalName: `capabilities.harness.validator_checks[${index}]`,
      tool: binding.tool,
      model: binding.model,
      agent: binding.agent,
    }, config)
    provider.setCwd?.(cwd)

    const raw = await provider.chat([{
      role: 'user',
      content: formatValidatorPrompt(label, cycle, issues, testsPassed, testOutput),
    }])
    const parsed = toValidatorDecision(raw)
    await writeFile(outputPath, JSON.stringify({
      raw,
      parsed,
    }, null, 2), 'utf-8')

    return {
      id,
      label,
      tool: binding.tool,
      model: binding.model,
      agent: binding.agent,
      outputPath,
      decision: parsed?.decision || 'unknown',
      rationale: parsed?.rationale || 'Validator returned no parsable JSON decision.',
      unresolvedItems: Array.isArray(parsed?.unresolvedItems) ? parsed!.unresolvedItems.filter(Boolean) : [],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(outputPath, JSON.stringify({
      error: message,
      parsed: null,
    }, null, 2), 'utf-8')

    return {
      id,
      label,
      tool: binding.tool,
      model: binding.model,
      agent: binding.agent,
      outputPath,
      decision: 'unknown',
      rationale: `${label} validator unavailable: ${message}`,
      unresolvedItems: [],
    }
  }
}

function isApproved(decision: DecisionJson | null, blockingIssueCount: number, testsPassed: boolean): boolean {
  if (blockingIssueCount > 0) return false
  if (!testsPassed) return false
  return decision?.decision === 'approved'
}

async function runCycle(
  cycle: number,
  cwd: string,
  configPath: string,
  reviewerIds: string[],
  validatorBindings: ModelRouteBinding[],
  reviewRounds: number,
  testCommand: string,
  sessionDir: string,
  config: MagpieConfigV2,
  routingDecision: RoutingDecision | undefined,
  routingDecisionPath: string,
): Promise<{ cycleResult: HarnessCycle; approved: boolean; routingDecision?: RoutingDecision }> {
  const cycleDir = join(sessionDir, `cycle-${cycle}`)
  await mkdir(cycleDir, { recursive: true })

  const reviewOutputPath = join(cycleDir, 'review.json')
  const adjudicationOutputPath = join(cycleDir, 'adjudication.json')
  const unitTestEvalPath = join(cycleDir, 'unit-test-eval.json')

  const cycleCtx = createCapabilityContext({ cwd, configPath })
  const qualityCtx = createCapabilityContext({
    cwd,
    configPath,
    metadata: { format: 'json' },
  })

  await runCapability(reviewCapability, {
    options: {
      config: configPath,
      rounds: String(reviewRounds),
      format: 'json',
      converge: true,
      local: true,
      reviewers: reviewerIds.join(','),
      all: false,
      deep: true,
      skipContext: true,
      post: false,
      interactive: false,
      output: reviewOutputPath,
    },
  }, cycleCtx)

  const reviewData = JSON.parse(await readFile(reviewOutputPath, 'utf-8')) as { parsedIssues?: MergedIssue[] }
  const allIssues = Array.isArray(reviewData.parsedIssues) ? reviewData.parsedIssues : []
  const blockingIssues = allIssues.filter(issue => BLOCKING_SEVERITIES.has(issue.severity))

  const unitEval = await runCapability(unitTestEvalCapability, {
    path: cwd,
    format: 'json',
    runTests: true,
    testCommand,
  }, qualityCtx)
  await writeFile(unitTestEvalPath, JSON.stringify(unitEval.result, null, 2), 'utf-8')
  const testsPassed = unitEval.result.testRun?.passed === true
  const testOutput = unitEval.result.testRun?.output || ''

  const validations = await Promise.all(
    validatorBindings.map((binding, index) => {
      const label = describeBindingLabel(binding)
      const outputPath = join(cycleDir, `validator-${index + 1}-${slugifyBindingLabel(label)}.json`)
      return runValidatorCheck(binding, index, cwd, config, cycle, blockingIssues, testsPassed, testOutput, outputPath)
    })
  )
  const validatorIssues = validations.flatMap((validation) =>
    validation.unresolvedItems.map((item, index) => ({
      severity: 'high',
      category: 'validator',
      file: `${validation.id}-validator`,
      line: index + 1,
      title: `${validation.label} unresolved item`,
      description: item,
      descriptions: [item],
      raisedBy: [validation.label],
    } satisfies MergedIssue))
  )
  const combinedBlockingIssues = [...blockingIssues, ...validatorIssues]

  const adjudicationTopic = buildAdjudicationTopic(cycle, combinedBlockingIssues, validations, testsPassed, testOutput)
  await runCapability(discussCapability, {
    topic: adjudicationTopic,
    options: {
      config: configPath,
      rounds: '2',
      format: 'json',
      converge: true,
      reviewers: reviewerIds.join(','),
      all: false,
      interactive: false,
      output: adjudicationOutputPath,
    },
  }, cycleCtx)

  const adjudicationData = JSON.parse(await readFile(adjudicationOutputPath, 'utf-8')) as { finalConclusion?: string }
  const decision = toDecision(adjudicationData.finalConclusion || '')
  const approved = isApproved(decision, combinedBlockingIssues.length, testsPassed)

  const cycleResult: HarnessCycle = {
    cycle,
    reviewOutputPath,
    validatorChecks: validations.map(toValidatorArtifact),
    adjudicationOutputPath,
    unitTestEvalPath,
    issueCount: allIssues.length + validatorIssues.length,
    blockingIssueCount: combinedBlockingIssues.length,
    testsPassed,
    modelDecision: decision?.decision || 'unknown',
    modelRationale: decision?.rationale || 'No parsable decision returned by discuss final conclusion.',
  }

  if (approved) {
    return { cycleResult, approved: true, routingDecision }
  }

  let nextRoutingDecision = routingDecision
  const escalationReason = routingDecision
    ? getEscalationReason({
      blockingIssueCount: combinedBlockingIssues.length,
      testsPassed,
      modelDecision: cycleResult.modelDecision,
    })
    : null

  if (routingDecision && escalationReason) {
    nextRoutingDecision = escalateRoutingDecision(routingDecision, config, escalationReason)
    applyBinding(config, 'loop', nextRoutingDecision.planning, nextRoutingDecision.execution)
    applyBinding(config, 'issue_fix', nextRoutingDecision.planning, nextRoutingDecision.execution)
    await writeFile(configPath, YAML.stringify(config), 'utf-8')
    await writeFile(routingDecisionPath, JSON.stringify(nextRoutingDecision, null, 2), 'utf-8')
  }

  const issueFix = await runCapability(issueFixCapability, {
    issue: buildIssueFixPrompt(cycle, combinedBlockingIssues, validations, testOutput, decision),
    apply: true,
    verifyCommand: testCommand,
  }, cycleCtx)

  cycleResult.issueFixSessionId = issueFix.result.session?.id
  return { cycleResult, approved: false, routingDecision: nextRoutingDecision }
}

export async function executeHarness(
  prepared: HarnessPreparedInput,
  ctx: CapabilityContext
): Promise<HarnessResult> {
  const config = loadConfig(ctx.configPath)
  const notificationRouter = createNotificationRouter(config.integrations.notifications)
  const progressObserver = getHarnessProgressObserver(ctx)
  const sessionId = process.env.MAGPIE_SESSION_ID?.trim() || generateWorkflowId('harness')
  const sessionDir = sessionDirFor(ctx.cwd, 'harness', sessionId)
  const roundsPath = join(sessionDir, 'rounds.json')
  const harnessConfigPath = join(sessionDir, 'harness.config.yaml')
  const providerSelectionPath = join(sessionDir, 'provider-selection.json')
  const routingDecisionPath = join(sessionDir, 'routing-decision.json')
  const eventsPath = join(sessionDir, 'events.jsonl')
  const existingSession = await loadWorkflowSession(ctx.cwd, 'harness', sessionId)
  const resumeState = resolveHarnessResumeState(
    existingSession,
    await loadPersistedHarnessCycles(roundsPath)
  )

  await mkdir(sessionDir, { recursive: true })
  const knowledgeArtifacts = await createTaskKnowledge({
    sessionDir,
    capability: 'harness',
    sessionId,
    title: prepared.goal.slice(0, 80),
    goal: prepared.goal,
  })
  await updateTaskKnowledgeSummary(
    knowledgeArtifacts,
    'plan',
    buildHarnessPlanSummary(prepared.goal),
    'Harness plan summary initialized.'
  )
  await updateTaskKnowledgeState(knowledgeArtifacts, resumeState.isResume
    ? {
      currentStage: existingSession?.currentStage || 'queued',
      lastReliableResult: existingSession?.summary || 'Harness workflow resumed.',
      nextAction: 'Resume from the last persisted harness checkpoint.',
      currentBlocker: 'Recovering interrupted harness execution.',
    }
    : {
      currentStage: 'queued',
      lastReliableResult: 'Harness workflow queued.',
      nextAction: 'Select providers and start loop development.',
      currentBlocker: 'Waiting for provider selection.',
    }, resumeState.isResume
    ? 'Harness state initialized from persisted session.'
    : 'Harness state initialized.')

  type HarnessSession = NonNullable<HarnessResult['session']>
  type HarnessSessionPatch = Omit<Partial<HarnessSession>, 'artifacts'> & {
    artifacts?: Partial<HarnessSession['artifacts']>
  }

  let session: HarnessSession = {
    ...(existingSession || {}),
    id: sessionId,
    capability: 'harness' as const,
    title: prepared.goal.slice(0, 80),
    createdAt: existingSession?.createdAt || new Date(),
    updatedAt: new Date(),
    status: 'in_progress' as const,
    currentStage: (existingSession?.currentStage as HarnessStage | undefined) || 'queued',
    summary: existingSession?.summary || 'Harness workflow queued.',
    artifacts: {
      ...(existingSession?.artifacts || {}),
      repoRootPath: ctx.cwd,
      harnessConfigPath,
      roundsPath,
      providerSelectionPath,
      routingDecisionPath,
      eventsPath,
      executionHost: prepared.host === 'tmux' || process.env.MAGPIE_EXECUTION_HOST === 'tmux' ? 'tmux' : 'foreground',
      ...(process.env.MAGPIE_TMUX_SESSION ? { tmuxSession: process.env.MAGPIE_TMUX_SESSION } : {}),
      ...(process.env.MAGPIE_TMUX_WINDOW ? { tmuxWindow: process.env.MAGPIE_TMUX_WINDOW } : {}),
      ...(process.env.MAGPIE_TMUX_PANE ? { tmuxPane: process.env.MAGPIE_TMUX_PANE } : {}),
      ...knowledgeArtifacts,
    },
    evidence: buildPersistedHarnessResumeEvidence(prepared, ctx.configPath, existingSession?.evidence),
  }
  let harnessConfig: MagpieConfigV2 = config
  let reviewerIds: string[] = []
  let validatorBindings: ModelRouteBinding[] = []

  const persistSession = async (
    patch: HarnessSessionPatch = {}
  ): Promise<void> => {
    const nextArtifacts = {
      ...session.artifacts,
    }
    for (const [key, value] of Object.entries(patch.artifacts || {})) {
      if (typeof value === 'string') {
        nextArtifacts[key] = value
      }
    }

    session = {
      ...session,
      ...patch,
      updatedAt: new Date(),
      artifacts: nextArtifacts,
    }
    await persistWorkflowSession(ctx.cwd, session)
    progressObserver?.onSessionUpdate?.(session)
  }

  const appendEvent = async (
    type: string,
    patch: {
      stage?: HarnessStage
      cycle?: number
      summary?: string
      details?: Record<string, unknown>
    } = {}
  ): Promise<void> => {
    const event = {
      timestamp: new Date(),
      type,
      ...patch,
    }
    await appendWorkflowEvent(ctx.cwd, 'harness', sessionId, event)
    progressObserver?.onEvent?.({
      sessionId,
      ...event,
    })
  }

  const finalizeKnowledgeBestEffort = async (
    content: string,
    candidates: KnowledgeCandidate[],
    logMessage: string
  ): Promise<void> => {
    try {
      await writeTaskKnowledgeFinal(
        knowledgeArtifacts,
        content,
        candidates,
        logMessage
      )
      await promoteKnowledgeCandidates(ctx.cwd, candidates)
    } catch {
      return
    }
  }

  const emitStageEntered = async (
    stage: HarnessStage,
    summary: string,
    details?: Record<string, unknown>
  ): Promise<void> => {
    const enteredNotification = await dispatchStageNotification({
      config: harnessConfig,
      cwd: resolve(ctx.cwd),
      eventsPath,
      router: notificationRouter,
      input: {
        eventType: 'stage_entered',
        sessionId,
        capability: 'harness',
        runTitle: prepared.goal,
        stage,
        summary,
        nextAction: nextHarnessAction(stage, details?.cycle as number | undefined),
        aiRoster: buildHarnessAiRoster(harnessConfig, reviewerIds, stage),
      },
      severity: stage === 'failed' ? 'error' : 'info',
      metadata: { stage, ...(details || {}) },
      dedupeKey: `stage_entered:${sessionId}:${stage}:${Date.now()}`,
    })
    await appendEvent('stage_entered', {
      stage,
      summary,
      details: {
        occurrence: enteredNotification.occurrence,
        delivered: enteredNotification.dispatch?.delivered ?? 0,
        attempted: enteredNotification.dispatch?.attempted ?? 0,
        ...(details || {}),
      },
    })
  }

  const emitStagePaused = async (
    stage: HarnessStage,
    summary: string,
    details?: Record<string, unknown>
  ): Promise<void> => {
    const pausedNotification = await dispatchStageNotification({
      config: harnessConfig,
      cwd: resolve(ctx.cwd),
      eventsPath,
      router: notificationRouter,
      input: {
        eventType: 'stage_paused',
        sessionId,
        capability: 'harness',
        runTitle: prepared.goal,
        stage,
        summary,
        blocker: summary,
        nextAction: '处理人工确认后恢复当前阶段。',
        aiRoster: buildHarnessAiRoster(harnessConfig, reviewerIds, stage),
      },
      severity: 'warning',
      metadata: { stage, ...(details || {}) },
      dedupeKey: `stage_paused:${sessionId}:${stage}:${Date.now()}`,
    })
    await appendEvent('stage_paused', {
      stage,
      summary,
      details: {
        occurrence: pausedNotification.occurrence,
        delivered: pausedNotification.dispatch?.delivered ?? 0,
        attempted: pausedNotification.dispatch?.attempted ?? 0,
        ...(details || {}),
      },
    })
  }

  const transitionStage = async (
    stage: HarnessStage,
    summary: string,
    eventType = 'stage_changed',
    details?: Record<string, unknown>
  ): Promise<void> => {
    const previousStage = session.currentStage
    if (previousStage) {
      const previousEventType = stage === 'failed' || previousStage === 'failed'
        ? 'stage_failed'
        : 'stage_completed'
      const previousStageSummary = previousEventType === 'stage_failed'
        ? summary
        : session.summary
      const previousStageBlocker = previousEventType === 'stage_failed'
        ? summary
        : previousStage === 'failed'
          ? session.summary
          : undefined
      const completedNotification = await dispatchStageNotification({
        config: harnessConfig,
        cwd: resolve(ctx.cwd),
        eventsPath,
        router: notificationRouter,
        input: {
          eventType: previousEventType,
          sessionId,
          capability: 'harness',
          runTitle: prepared.goal,
          stage: previousStage,
          summary: previousStageSummary,
          blocker: previousStageBlocker,
          nextAction: nextHarnessAction(stage, details?.cycle as number | undefined),
          aiRoster: buildHarnessAiRoster(harnessConfig, reviewerIds, previousStage as HarnessStage),
        },
        severity: previousEventType === 'stage_failed' ? 'error' : 'info',
        metadata: { previousStage, nextStage: stage, ...(details || {}) },
        dedupeKey: `${previousEventType}:${sessionId}:${previousStage}:${Date.now()}`,
      })
      await appendEvent(previousEventType, {
        stage: previousStage,
        summary: previousStageSummary,
        details: {
          occurrence: completedNotification.occurrence,
          delivered: completedNotification.dispatch?.delivered ?? 0,
          attempted: completedNotification.dispatch?.attempted ?? 0,
          nextStage: stage,
          ...(details || {}),
        },
      })
    }

    await persistSession({
      currentStage: stage,
      summary,
    })
    await updateTaskKnowledgeState(knowledgeArtifacts, {
      currentStage: stage,
      lastReliableResult: summary,
      nextAction: stage === 'queued'
        ? 'Select providers and start loop development.'
        : stage === 'developing'
          ? 'Wait for loop development stage.'
          : stage === 'reviewing'
            ? 'Run the current review cycle.'
            : 'No further action.',
      currentBlocker: stage === 'failed'
        ? summary
        : stage === 'completed'
          ? 'None.'
          : 'Stage in progress.',
    }, `Harness state moved to ${stage}.`)
    await emitStageEntered(stage, summary, details)
    await appendEvent(eventType, {
      stage,
      summary,
      details,
    })
  }

  await persistSession()
  await appendEvent(resumeState.isResume ? 'workflow_resumed' : 'workflow_started', {
    stage: session.currentStage || 'queued',
    summary: resumeState.isResume ? 'Harness workflow resumed.' : 'Harness workflow started.',
    ...(resumeState.isResume
      ? {
        details: {
          resumedStage: session.currentStage || 'queued',
          completedCycles: resumeState.completedCycles.length,
        },
      }
      : {}),
  })

  let routingDecision = isRoutingEnabled(config)
    ? createRoutingDecision({
      goal: prepared.goal,
      prdContent: await readFile(prepared.prdPath, 'utf-8').catch(() => ''),
      overrideTier: prepared.complexity,
      config,
    })
    : undefined

  ;({ config: harnessConfig, reviewerIds } = applyHarnessConfigOverrides(
    config,
    prepared.models,
    prepared.modelsExplicit,
    routingDecision
  ))
  validatorBindings = resolveHarnessValidatorBindings(harnessConfig)
  const providerSelection = selectHarnessProviders(harnessConfig, reviewerIds, resolve(ctx.cwd), ctx.now)
  await writeFile(providerSelectionPath, JSON.stringify(providerSelection.record, null, 2), 'utf-8')
  await writeFile(harnessConfigPath, YAML.stringify(harnessConfig), 'utf-8')
  if (routingDecision) {
    await writeFile(routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
  }
  await emitStageEntered('queued', session.summary)

  if (providerSelection.record.decision === 'fallback_failed') {
    const summary = `Harness failed before development started: Kiro fallback unavailable. ${providerSelection.record.kiroCheck.reason || ''}`.trim()
    const candidates = buildHarnessCandidates(prepared.goal, sessionId, false, summary, providerSelectionPath)
    await transitionStage('failed', summary, 'workflow_failed', {
      reason: providerSelection.record.kiroCheck.reason || 'Kiro fallback unavailable.',
    })
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
    })
    await updateTaskKnowledgeState(knowledgeArtifacts, {
      currentStage: 'failed',
      lastReliableResult: summary,
      nextAction: 'Inspect provider fallback details and replan.',
      currentBlocker: providerSelection.record.kiroCheck.reason || 'Kiro fallback unavailable.',
    }, 'Harness state marked failed before development started.')
    await finalizeKnowledgeBestEffort(
      ['# Final Summary', '', summary].join('\n'),
      candidates,
      'Harness failed before development started.'
    )

    return {
      status: 'failed',
      session,
    }
  }

  const harnessCtx = createCapabilityContext({
    cwd: ctx.cwd,
    configPath: harnessConfigPath,
    metadata: {
      loopProgress: {
        onSessionUpdate: (loopSession: {
          id: string
          artifacts?: {
            eventsPath?: string
            workspaceMode?: 'current' | 'worktree'
            workspacePath?: string
            worktreeBranch?: string
          }
        }) => {
          void persistSession({
            artifacts: {
              loopSessionId: loopSession.id,
              ...(loopSession.artifacts?.eventsPath ? { loopEventsPath: loopSession.artifacts.eventsPath } : {}),
              ...(loopSession.artifacts?.workspaceMode ? { workspaceMode: loopSession.artifacts.workspaceMode } : {}),
              ...(loopSession.artifacts?.workspacePath ? { workspacePath: loopSession.artifacts.workspacePath } : {}),
              ...(loopSession.artifacts?.worktreeBranch ? { worktreeBranch: loopSession.artifacts.worktreeBranch } : {}),
            },
          })
        },
        onEvent: (event: {
          ts: string
          event: string
          stage?: string
          summary?: string
          reason?: string
          provider?: string
          progressType?: string
          cycle?: number
        }) => {
          progressObserver?.onEvent?.({
            sessionId,
            timestamp: event.ts,
            type: event.event,
            ...(event.stage ? { stage: event.stage as HarnessStage } : {}),
            ...(Number.isFinite(event.cycle) ? { cycle: event.cycle } : {}),
            ...(event.summary || event.reason ? { summary: event.summary || event.reason } : {}),
            ...(event.provider ? { provider: event.provider } : {}),
            ...(event.progressType ? { progressType: event.progressType } : {}),
          } as never)
        },
      },
    },
  })

  let loopResult: {
    prepared: LoopPreparedInput
    result: LoopExecutionResult
    output: LoopSummaryOutput
  } | null = null

  if (!resumeState.canReuseCompletedDevelopment) {
    await transitionStage(
      'developing',
      resumeState.shouldResumeLoop ? 'Resuming loop development stage.' : 'Running loop development stage.'
    )

    loopResult = await runCapability(loopCapability, resumeState.shouldResumeLoop
      ? {
        mode: 'resume',
        sessionId: existingSession?.artifacts.loopSessionId,
        waitHuman: false,
        complexity: prepared.complexity,
        host: prepared.host,
      }
      : {
        mode: 'run',
        goal: prepared.goal,
        prdPath: prepared.prdPath,
        waitHuman: false,
        complexity: prepared.complexity,
        host: prepared.host,
      }, harnessCtx)
  } else {
    await persistSession({
      summary: resumeState.completedCycles.length > 0
        ? `Resuming after completed cycle ${resumeState.completedCycles.length}.`
        : 'Resuming after completed development stage.',
    })
    await appendEvent('workflow_resumed_checkpoint', {
      stage: 'reviewing',
      summary: resumeState.completedCycles.length > 0
        ? `Resuming review cycle ${resumeState.completedCycles.length + 1}.`
        : 'Skipping development stage because it already completed.',
      details: {
        completedCycles: resumeState.completedCycles.length,
        loopSessionId: existingSession?.artifacts.loopSessionId,
      },
    })
  }

  if (loopResult && loopResult.result.status !== 'completed') {
    const loopPausedForHuman = loopResult.result.status === 'paused'
      || loopResult.result.session?.status === 'paused_for_human'

    if (loopPausedForHuman) {
      const summary = 'Harness paused during loop development stage for human intervention.'
      await persistSession({
        status: 'blocked',
        currentStage: 'developing',
        summary,
        artifacts: {
          ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
          ...(loopResult.result.session?.artifacts?.eventsPath ? { loopEventsPath: loopResult.result.session.artifacts.eventsPath } : {}),
          ...(loopResult.result.session?.artifacts?.workspaceMode ? { workspaceMode: loopResult.result.session.artifacts.workspaceMode } : {}),
          ...(loopResult.result.session?.artifacts?.workspacePath ? { workspacePath: loopResult.result.session.artifacts.workspacePath } : {}),
          ...(loopResult.result.session?.artifacts?.worktreeBranch ? { worktreeBranch: loopResult.result.session.artifacts.worktreeBranch } : {}),
        },
      })
      await updateTaskKnowledgeState(knowledgeArtifacts, {
        currentStage: 'developing',
        lastReliableResult: summary,
        nextAction: '处理人工确认后恢复开发阶段。',
        currentBlocker: summary,
      }, 'Harness paused during loop development stage for human intervention.')
      await emitStagePaused('developing', summary, {
        loopSessionId: loopResult.result.session?.id,
      })

      return {
        status: 'blocked',
        session,
      }
    }

    const summary = 'Harness failed during loop development stage.'
    const candidates = buildHarnessCandidates(prepared.goal, sessionId, false, summary, eventsPath)
    await transitionStage('failed', summary, 'workflow_failed', {
      loopSessionId: loopResult.result.session?.id,
    })
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
      artifacts: {
        ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
        ...(loopResult.result.session?.artifacts?.eventsPath ? { loopEventsPath: loopResult.result.session.artifacts.eventsPath } : {}),
        ...(loopResult.result.session?.artifacts?.workspaceMode ? { workspaceMode: loopResult.result.session.artifacts.workspaceMode } : {}),
        ...(loopResult.result.session?.artifacts?.workspacePath ? { workspacePath: loopResult.result.session.artifacts.workspacePath } : {}),
        ...(loopResult.result.session?.artifacts?.worktreeBranch ? { worktreeBranch: loopResult.result.session.artifacts.worktreeBranch } : {}),
      },
    })
    await updateTaskKnowledgeState(knowledgeArtifacts, {
      currentStage: 'failed',
      lastReliableResult: summary,
      nextAction: 'Inspect loop development failure and replan.',
      currentBlocker: 'Loop development did not complete successfully.',
    }, 'Harness state marked failed during loop development stage.')
    await finalizeKnowledgeBestEffort(
      ['# Final Summary', '', summary].join('\n'),
      candidates,
      'Harness failed during loop development stage.'
    )

    return {
      status: 'failed',
      session,
    }
  }

  if (loopResult) {
    await persistSession({
        artifacts: {
          ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
          ...(loopResult.result.session?.artifacts?.eventsPath ? { loopEventsPath: loopResult.result.session.artifacts.eventsPath } : {}),
          ...(loopResult.result.session?.artifacts?.workspaceMode ? { workspaceMode: loopResult.result.session.artifacts.workspaceMode } : {}),
          ...(loopResult.result.session?.artifacts?.workspacePath ? { workspacePath: loopResult.result.session.artifacts.workspacePath } : {}),
          ...(loopResult.result.session?.artifacts?.worktreeBranch ? { worktreeBranch: loopResult.result.session.artifacts.worktreeBranch } : {}),
      },
    })
  }
  await updateTaskKnowledgeSummary(
    knowledgeArtifacts,
    'plan',
    [
      buildHarnessPlanSummary(prepared.goal),
      '',
      session.artifacts.loopSessionId ? `Loop session: ${session.artifacts.loopSessionId}` : 'Loop session: unavailable',
    ].join('\n'),
    'Harness linked loop session.'
  )

  const testCommand = prepared.testCommand || config.capabilities.loop?.commands?.unit_test || 'npm run test:run'
  const cycles: HarnessCycle[] = [...resumeState.completedCycles]
  let approved = resumeState.approvedFromCompletedCycles

  try {
    for (let cycle = cycles.length + 1; cycle <= prepared.maxCycles; cycle++) {
      await transitionStage('reviewing', `Running review cycle ${cycle}.`, 'stage_changed', { cycle })
      const cycleRun = await runCycle(
        cycle,
        resolve(ctx.cwd),
        harnessConfigPath,
        reviewerIds,
        validatorBindings,
        prepared.reviewRounds,
        testCommand,
        sessionDir,
        harnessConfig,
        routingDecision,
        routingDecisionPath,
      )
      routingDecision = cycleRun.routingDecision
      if (routingDecision && !prepared.modelsExplicit) {
        reviewerIds = [...routingDecision.reviewerIds]
        alignSummaryRoles(harnessConfig, reviewerIds)
        await writeFile(harnessConfigPath, YAML.stringify(harnessConfig), 'utf-8')
      }
      cycles.push(cycleRun.cycleResult)
      await writeFile(roundsPath, JSON.stringify(cycles, null, 2), 'utf-8')
      await updateTaskKnowledgeSummary(
        knowledgeArtifacts,
        `stage-cycle-${cycle}`,
        buildHarnessCycleSummary(cycleRun.cycleResult),
        `Cycle ${cycle} summary updated.`
      )
      await updateTaskKnowledgeSummary(
        knowledgeArtifacts,
        'open-issues',
        buildHarnessOpenIssues(cycleRun.cycleResult),
        `Cycle ${cycle} open issues updated.`
      )
      await updateTaskKnowledgeSummary(
        knowledgeArtifacts,
        'evidence',
        buildHarnessEvidence(cycleRun.cycleResult),
        `Cycle ${cycle} evidence updated.`
      )
      await persistSession({
        summary: cycleRun.approved
          ? `Cycle ${cycle} approved.`
          : `Cycle ${cycle} requested more changes.`,
      })
      await appendEvent('cycle_completed', {
        stage: cycleRun.approved ? 'completed' : 'reviewing',
        cycle,
        summary: cycleRun.approved
          ? `Cycle ${cycle} approved.`
          : `Cycle ${cycle} requested more changes.`,
        details: {
          approved: cycleRun.approved,
          blockingIssueCount: cycleRun.cycleResult.blockingIssueCount,
          testsPassed: cycleRun.cycleResult.testsPassed,
          modelDecision: cycleRun.cycleResult.modelDecision,
        },
      })
      if (cycleRun.approved) {
        approved = true
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const summary = `Harness failed during review cycle: ${message}`
    const candidates = buildHarnessCandidates(prepared.goal, sessionId, false, summary, roundsPath)
    await transitionStage('failed', summary, 'workflow_failed', { error: message })
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
    })
    await updateTaskKnowledgeState(knowledgeArtifacts, {
      currentStage: 'failed',
      lastReliableResult: summary,
      nextAction: 'Inspect the failing review cycle and replan.',
      currentBlocker: message,
    }, 'Harness state marked failed during review cycle.')
    await finalizeKnowledgeBestEffort(
      ['# Final Summary', '', summary].join('\n'),
      candidates,
      'Harness failed during review cycle.'
    )
    return { status: 'failed', session }
  }

  const summary = approved
    ? `Harness approved after ${cycles.length} cycle(s).`
    : `Harness failed after ${cycles.length} cycle(s) without approval.`
  const finalCandidates = buildHarnessCandidates(
    prepared.goal,
    sessionId,
    approved,
    summary,
    roundsPath
  )
  await transitionStage(approved ? 'completed' : 'failed', summary, approved ? 'workflow_completed' : 'workflow_failed', {
    totalCycles: cycles.length,
  })
  await persistSession({
    status: approved ? 'completed' : 'failed',
    currentStage: approved ? 'completed' : 'failed',
    summary,
  })
  await updateTaskKnowledgeState(knowledgeArtifacts, {
    currentStage: approved ? 'completed' : 'failed',
    lastReliableResult: summary,
    nextAction: approved ? 'No further action.' : 'Inspect unresolved review findings and retry.',
    currentBlocker: approved ? 'None.' : 'Harness did not receive approval.',
  }, `Harness state marked ${approved ? 'completed' : 'failed'}.`)
  await finalizeKnowledgeBestEffort(
    [
      '# Final Summary',
      '',
      summary,
      '',
      cycles.length > 0
        ? `Latest cycle decision: ${cycles[cycles.length - 1]?.modelDecision}`
        : 'No review cycles completed.',
    ].join('\n'),
    finalCandidates,
    approved ? 'Harness completed successfully.' : 'Harness finished without approval.'
  )

  return {
    status: approved ? 'completed' : 'failed',
    session,
  }
}

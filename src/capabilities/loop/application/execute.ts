import { randomBytes } from 'crypto'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import type { CapabilityContext } from '../../../core/capability/context.js'
import { createRoutingDecision, isRoutingEnabled } from '../../routing/index.js'
import type {
  HumanConfirmationItem,
  LoopReliablePoint,
  LoopSession,
  LoopStageResult,
  LoopTask,
} from '../../../core/state/index.js'
import { StateManager } from '../../../core/state/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { getRepoSessionDir } from '../../../platform/paths.js'
import { createConfiguredProvider } from '../../../platform/providers/index.js'
import type { AIProvider, Message } from '../../../platform/providers/index.js'
import type { ComplexityTier, LoopConfig, LoopStageName, MagpieConfig } from '../../../config/types.js'
import type { NotificationEvent } from '../../../platform/integrations/notifications/types.js'
import { createNotificationRouter } from '../../../platform/integrations/notifications/factory.js'
import { dispatchStageNotification } from '../../../platform/integrations/notifications/stage-dispatch.js'
import { createPlanningRouter } from '../../../platform/integrations/planning/factory.js'
import {
  buildPlanningContextBlock,
  extractPlanningItemKey,
} from '../../../platform/integrations/planning/index.js'
import {
  buildCommandSafetyConfig,
  runSafeCommand,
} from '../../workflows/shared/runtime.js'
import {
  generateDocumentPlan,
  renderDocumentPlanForStage,
  type DocumentPlan,
} from '../../../core/project-documents/document-plan.js'
import { extractJsonBlock } from '../../../trd/renderer.js'
import {
  appendHumanConfirmationItem,
  findHumanConfirmationDecision,
} from '../domain/human-confirmation.js'
import { createLoopMr, type LoopMrAttemptResult } from '../domain/auto-mr.js'
import { generateAutoCommitMessage } from '../domain/auto-commit-message.js'
import { resolveAutoCommitProviderBinding } from '../domain/auto-commit-provider-binding.js'
import { generateLoopPlan } from '../domain/planner.js'
import {
  createConstraintsSnapshot,
  evaluatePlanningConstraints,
  loadLoopConstraints,
} from '../domain/constraints.js'
import {
  assessTddEligibility,
  createTddTarget,
  recordRedTestResult,
} from '../domain/tdd.js'
import {
  recordStructuredTestResult,
  runStructuredTestCommand,
} from '../domain/test-execution.js'
import {
  advanceRepairState,
  writeRepairArtifacts,
} from '../domain/repair.js'
import {
  buildRoleRoster,
  createRoleRoundResult,
  createRoleMessage,
  getRoleArtifactPaths,
  resolveRoleBindings,
  serializeRoleMessage,
} from '../../../core/roles/index.js'
import type { LoopExecutionResult, LoopPreparedInput } from '../types.js'
import {
  createTaskKnowledge,
  promoteKnowledgeCandidates,
  renderKnowledgeContext,
  updateTaskKnowledgeState,
  updateTaskKnowledgeSummary,
  writeTaskKnowledgeFinal,
  type KnowledgeArtifacts,
  type KnowledgeCandidate,
} from '../../../knowledge/runtime.js'
import { getLoopProgressObserver, type LoopProgressObserver } from '../progress.js'

const DEFAULT_STAGES: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'code_development',
  'unit_mock_test',
  'integration_test',
]

interface LoopRuntimeConfig {
  plannerTool?: string
  plannerModel: string
  plannerAgent?: string
  executorTool?: string
  executorModel: string
  executorAgent?: string
  autoCommitModel?: string
  stages: LoopStageName[]
  confidenceThreshold: number
  retriesPerStage: number
  maxIterations: number
  autoCommit: boolean
  autoMr: boolean
  reuseCurrentBranch: boolean
  autoBranchPrefix: string
  humanConfirmationFile: string
  pollIntervalSec: number
  gatePolicy: 'exception_or_low_confidence' | 'always' | 'manual_only'
  commands: {
    unitTest: string
    mockTest?: string
    integrationTest: string
  }
  executionTimeout: {
    defaultMs: number
    minMs: number
    maxMs: number
    complexityMultiplier: Record<ComplexityTier, number>
    stageOverridesMs: Partial<Record<LoopStageName, number>>
  }
}

interface StageEvaluation {
  confidence: number
  risks: string[]
  requireHumanConfirmation: boolean
  summary: string
  parseFailed?: boolean
}

interface StageRunResult {
  stageResult: LoopStageResult
  paused: boolean
  failed: boolean
  stageReport: string
  testOutput: string
}

function toRoleBinding(input: { tool?: string; model?: string; agent?: string }): { tool?: string; model?: string; agent?: string } | undefined {
  if (!input.tool && !input.model) return undefined
  return {
    ...(input.tool ? { tool: input.tool } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
  }
}

function applyLoopRoleBindingOverrides(config: LoopConfig | undefined, runtime: LoopRuntimeConfig): void {
  const architect = config?.role_bindings?.architect
  if (architect) {
    runtime.plannerTool = architect.tool
    runtime.plannerModel = architect.model || architect.tool || runtime.plannerModel
    runtime.plannerAgent = architect.agent
  }

  const developer = config?.role_bindings?.developer
  if (developer) {
    runtime.executorTool = developer.tool
    runtime.executorModel = developer.model || developer.tool || runtime.executorModel
    runtime.executorAgent = developer.agent
  }
}

function buildLoopRoleRoster(runtime: LoopRuntimeConfig) {
  return buildRoleRoster(resolveRoleBindings(undefined, {
    architect: toRoleBinding({
      tool: runtime.plannerTool,
      model: runtime.plannerModel,
      agent: runtime.plannerAgent,
    }),
    developer: toRoleBinding({
      tool: runtime.executorTool,
      model: runtime.executorModel,
      agent: runtime.executorAgent,
    }),
    tester: toRoleBinding({
      tool: runtime.executorTool,
      model: runtime.executorModel,
      agent: runtime.executorAgent,
    }),
  }))
}

interface WorktreeResolution {
  workspaceMode: 'current' | 'worktree'
  workspacePath: string
  worktreeBranch?: string
  failureReason?: string
}

const RELIABLE_POINTS: LoopReliablePoint[] = [
  'constraints_validated',
  'red_test_confirmed',
  'implementation_generated',
  'test_result_recorded',
  'completed',
]

function isReliablePoint(value: unknown): value is LoopReliablePoint {
  return typeof value === 'string' && RELIABLE_POINTS.includes(value as LoopReliablePoint)
}

function validateResumeCheckpoint(session: LoopSession): string | null {
  const stage = session.stages[session.currentStageIndex]
  if (stage !== 'code_development') {
    return null
  }

  const hasCheckpointDependentState = session.constraintsValidated
    || session.tddEligible
    || session.redTestConfirmed
    || Boolean(session.currentLoopState)
    || Boolean(session.artifacts.redTestResultPath)
    || Boolean(session.artifacts.greenTestResultPath)

  if (!hasCheckpointDependentState) {
    return null
  }

  if (!session.lastReliablePoint) {
    return 'Cannot safely resume because no reliable checkpoint was recorded for code development.'
  }

  if (!isReliablePoint(session.lastReliablePoint)) {
    return `Cannot safely resume because "${session.lastReliablePoint}" is not a complete reliable checkpoint.`
  }

  if (session.lastReliablePoint === 'red_test_confirmed' && session.redTestConfirmed !== true) {
    return 'Cannot safely resume because the saved checkpoint says the red test was confirmed, but that result is missing.'
  }

  if (session.lastReliablePoint === 'test_result_recorded' && !session.artifacts.greenTestResultPath) {
    return 'Cannot safely resume because the saved checkpoint says a test result was recorded, but the test result artifact is missing.'
  }

  if (session.lastReliablePoint === 'test_result_recorded'
    && !session.stageResults.some((stageResult) => stageResult.stage === stage)) {
    return 'Cannot safely resume because the saved checkpoint says a test result was recorded, but the stage result is missing.'
  }

  return null
}

function buildTestFailureSummary(
  result: {
    failureKind: 'quality' | 'execution' | null
    firstError: string | null
    failedTests: string[]
  },
  qualityFallback: string
): string {
  if (result.failureKind === 'execution') {
    return `测试执行出现事故：${result.firstError || '命令未正常执行'}`
  }

  return `实现后测试仍失败：${result.firstError || result.failedTests[0] || qualityFallback}`
}

function buildRepairPrompt(stage: LoopStageName, session: LoopSession, summary: string): string {
  return [
    `You are retrying the implementation for stage "${stage}".`,
    '',
    `Goal: ${session.goal}`,
    '',
    `Failure summary: ${summary}`,
    session.artifacts.tddTargetPath ? `TDD target: ${session.artifacts.tddTargetPath}` : '',
    'Update production code only.',
    'Do not bypass the existing test command.',
    'Keep changes minimal and focused on the failing behavior.',
  ].filter(Boolean).join('\n')
}

function describeLoopActor(binding: {
  tool?: string
  model?: string
  agent?: string
}, fallbackId: string, role: string): { id: string; role: string } {
  return {
    id: binding.agent || binding.model || binding.tool || fallbackId,
    role,
  }
}

function buildLoopAiRoster(
  runtime: LoopRuntimeConfig,
  stage: LoopStageName
): Array<{ id: string; role: string }> {
  return [
    describeLoopActor({
      tool: runtime.plannerTool,
      model: runtime.plannerModel,
      agent: runtime.plannerAgent,
    }, 'planner', '负责阶段判断、风险评估和必要时的重试建议'),
    describeLoopActor({
      tool: runtime.executorTool,
      model: runtime.executorModel,
      agent: runtime.executorAgent,
    }, 'executor', `负责执行 ${stage} 阶段的实际工作`),
  ]
}

function nextLoopAction(session: LoopSession, stageIndex: number, paused = false): string {
  if (paused) {
    return '等待人工确认后再继续当前阶段。'
  }
  return session.stages[stageIndex + 1]
    ? `继续进入 ${session.stages[stageIndex + 1]} 阶段。`
    : '收尾并结束本次 loop。'
}

function generateId(): string {
  return randomBytes(6).toString('hex')
}

function resolveLoopConfig(config: LoopConfig | undefined): LoopRuntimeConfig {
  return {
    plannerTool: config?.planner_tool,
    plannerModel: config?.planner_model || 'claude-code',
    plannerAgent: config?.planner_agent,
    executorTool: config?.executor_tool,
    executorModel: config?.executor_model || 'codex',
    executorAgent: config?.executor_agent,
    autoCommitModel: config?.auto_commit_model?.trim() || undefined,
    stages: config?.stages && config.stages.length > 0 ? config.stages : DEFAULT_STAGES,
    confidenceThreshold: config?.confidence_threshold ?? 0.78,
    retriesPerStage: config?.retries_per_stage ?? 2,
    maxIterations: config?.max_iterations ?? 30,
    autoCommit: config?.auto_commit !== false,
    autoMr: config?.mr?.enabled === true,
    reuseCurrentBranch: config?.reuse_current_branch === true,
    autoBranchPrefix: config?.auto_branch_prefix || 'sch/',
    humanConfirmationFile: config?.human_confirmation?.file || 'human_confirmation.md',
    pollIntervalSec: config?.human_confirmation?.poll_interval_sec || 8,
    gatePolicy: config?.human_confirmation?.gate_policy || 'exception_or_low_confidence',
    commands: {
      unitTest: config?.commands?.unit_test || 'npm run test:run',
      mockTest: config?.commands?.mock_test?.trim() || undefined,
      integrationTest: config?.commands?.integration_test || 'npm run test:run -- tests/integration',
    },
    executionTimeout: {
      defaultMs: config?.execution_timeout?.default_ms ?? 15 * 60 * 1000,
      minMs: config?.execution_timeout?.min_ms ?? 5 * 60 * 1000,
      maxMs: config?.execution_timeout?.max_ms ?? 60 * 60 * 1000,
      complexityMultiplier: {
        simple: config?.execution_timeout?.complexity_multiplier?.simple ?? 1,
        standard: config?.execution_timeout?.complexity_multiplier?.standard ?? 2,
        complex: config?.execution_timeout?.complexity_multiplier?.complex ?? 3,
      },
      stageOverridesMs: config?.execution_timeout?.stage_overrides_ms || {},
    },
  }
}

function clampTimeoutMs(value: number, minMs: number, maxMs: number): number {
  return Math.max(minMs, Math.min(maxMs, value))
}

function resolveStageTimeoutMs(
  runtime: LoopRuntimeConfig,
  stage: LoopStageName,
  tier: ComplexityTier
): number {
  const base = runtime.executionTimeout.stageOverridesMs[stage] ?? runtime.executionTimeout.defaultMs
  const multiplier = runtime.executionTimeout.complexityMultiplier[tier] ?? 1
  return clampTimeoutMs(
    Math.round(base * multiplier),
    runtime.executionTimeout.minMs,
    runtime.executionTimeout.maxMs,
  )
}

function applyLoopProviderTimeouts(
  planner: AIProvider,
  executor: AIProvider,
  runtime: LoopRuntimeConfig,
  stage: LoopStageName,
  tier: ComplexityTier
): number {
  const timeoutMs = resolveStageTimeoutMs(runtime, stage, tier)
  planner.setTimeoutMs?.(timeoutMs)
  executor.setTimeoutMs?.(timeoutMs)
  return timeoutMs
}

function resolveSessionComplexityTier(
  session: LoopSession,
  override?: ComplexityTier
): ComplexityTier | undefined {
  if (override) return override
  if (session.selectedComplexity) return session.selectedComplexity
  if (session.routingTier) return session.routingTier
  if (session.artifacts.workspaceMode === 'worktree') return 'complex'
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveFn => setTimeout(resolveFn, ms))
}

function runOptionalCommand(
  cwd: string,
  command: string | undefined,
  skippedMessage: string,
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>
): { passed: boolean; output: string; commandLabel: string } {
  if (!command) {
    return {
      passed: true,
      output: skippedMessage,
      commandLabel: '(skipped)',
    }
  }

  const result = runSafeCommand(cwd, command, {
    safety: commandSafety,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  })
  return {
    ...result,
    commandLabel: command,
  }
}

function renderPlanSummary(tasks: LoopTask[]): string {
  return [
    '# Plan',
    '',
    ...tasks.map((task) => `- [${task.stage}] ${task.title}: ${task.description}`),
  ].join('\n')
}

function renderStageKnowledge(stageRun: StageRunResult): string {
  return [
    `# Stage ${stageRun.stageResult.stage}`,
    '',
    `Success: ${stageRun.stageResult.success ? 'yes' : 'no'}`,
    `Confidence: ${stageRun.stageResult.confidence}`,
    '',
    stageRun.stageResult.summary,
    '',
    stageRun.stageResult.risks.length > 0 ? 'Risks:' : 'Risks: none',
    ...stageRun.stageResult.risks.map((risk) => `- ${risk}`),
    '',
    'Artifacts:',
    ...(stageRun.stageResult.artifacts.length > 0
      ? stageRun.stageResult.artifacts.map((artifact) => `- ${artifact}`)
      : ['- None']),
  ].join('\n')
}

function renderOpenIssues(stageRun: StageRunResult): string {
  if (stageRun.stageResult.success && stageRun.stageResult.risks.length === 0) {
    return '# Open Issues\n\n- None.\n'
  }

  return [
    '# Open Issues',
    '',
    ...(
      stageRun.stageResult.risks.length > 0
        ? stageRun.stageResult.risks.map((risk) => `- ${risk}`)
        : ['- Stage did not complete successfully.']
    ),
  ].join('\n')
}

function renderEvidence(stageRun: StageRunResult): string {
  const excerpt = stageRun.testOutput
    ? stageRun.testOutput.slice(0, 400)
    : stageRun.stageReport.slice(0, 400)

  return [
    '# Evidence',
    '',
    ...stageRun.stageResult.artifacts.map((artifact) => `- ${artifact}`),
    excerpt ? '' : undefined,
    excerpt ? 'Excerpt:' : undefined,
    excerpt ? excerpt : undefined,
  ].filter(Boolean).join('\n')
}

function mergeStageReportWithVerification(stageReport: string, testOutput: string): string {
  if (!testOutput.trim()) {
    return stageReport
  }

  const base = stageReport.trimEnd()
  return [
    base,
    '',
    '# Verification',
    '',
    testOutput,
  ].join('\n')
}

function buildLoopRoleOpenIssuesMarkdown(issues: Array<{
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  requiredAction: string
}>): string {
  if (issues.length === 0) {
    return '# Open Issues\n\n- None.\n'
  }

  return [
    '# Open Issues',
    '',
    ...issues.map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.requiredAction}`),
  ].join('\n')
}

function buildLoopNextRoundBrief(
  session: LoopSession,
  stage: LoopStageName,
  reason: string,
  finalAction: 'revise' | 'requeue_or_blocked'
): string {
  const lead = finalAction === 'revise'
    ? `继续 ${stage} 阶段，先解决当前失败，再重跑现有测试命令。`
    : `继续 ${stage} 阶段前，先处理当前阻塞，再决定是否重试。`

  const refs = [
    session.artifacts.repairOpenIssuesPath ? `问题清单：${session.artifacts.repairOpenIssuesPath}` : undefined,
    session.artifacts.repairEvidencePath ? `失败证据：${session.artifacts.repairEvidencePath}` : undefined,
    session.artifacts.tddTargetPath ? `TDD 目标：${session.artifacts.tddTargetPath}` : undefined,
    session.artifacts.constraintsSnapshotPath ? `约束快照：${session.artifacts.constraintsSnapshotPath}` : undefined,
  ].filter(Boolean)

  return [
    lead,
    `原因：${reason}`,
    refs.length > 0 ? `最少输入：${refs.join('；')}` : '最少输入：当前失败原因和现有会话产物。',
  ].join(' ')
}

function buildLoopNextRoundMarkdown(input: {
  session: LoopSession
  stage: LoopStageName
  reason: string
  nextRoundBrief: string
  finalAction: 'revise' | 'requeue_or_blocked'
}): string {
  const minimumInputs = [
    `- Goal: ${input.session.goal}`,
    `- Stage: ${input.stage}`,
    `- Reliable point: ${input.session.lastReliablePoint || 'unknown'}`,
    `- Reason: ${input.reason}`,
    input.session.artifacts.repairOpenIssuesPath ? `- Open issues: ${input.session.artifacts.repairOpenIssuesPath}` : undefined,
    input.session.artifacts.repairEvidencePath ? `- Evidence: ${input.session.artifacts.repairEvidencePath}` : undefined,
    input.session.artifacts.tddTargetPath ? `- TDD target: ${input.session.artifacts.tddTargetPath}` : undefined,
    input.session.artifacts.constraintsSnapshotPath ? `- Constraints snapshot: ${input.session.artifacts.constraintsSnapshotPath}` : undefined,
  ].filter(Boolean)

  return [
    '# Next Round Input',
    '',
    `Final action: ${input.finalAction}`,
    `Goal: ${input.session.goal}`,
    `Stage: ${input.stage}`,
    '',
    'Minimum input:',
    ...minimumInputs,
    '',
    'Next step:',
    input.nextRoundBrief,
  ].join('\n')
}

async function persistLoopNextRoundInput(input: {
  session: LoopSession
  stage: LoopStageName
  stageIndex: number
  reason: string
  finalAction: 'revise' | 'requeue_or_blocked'
  fromRole: 'architect' | 'developer' | 'tester'
  toRole?: 'architect' | 'developer'
  progressObserver?: LoopProgressObserver
}): Promise<void> {
  const roleArtifacts = getRoleArtifactPaths(input.session.artifacts.sessionDir)
  const roundId = `round-${input.stageIndex + 1}`
  const roleRoundPath = join(roleArtifacts.roundsDir, `${roundId}.json`)
  const roleOpenIssuesPath = join(roleArtifacts.roundsDir, `${roundId}-open-issues.md`)
  const roleNextRoundPath = join(roleArtifacts.roundsDir, `${roundId}-next.md`)
  const nextRoundBrief = buildLoopNextRoundBrief(
    input.session,
    input.stage,
    input.reason,
    input.finalAction
  )
  const evidencePath = input.session.artifacts.repairEvidencePath
    || input.session.artifacts.greenTestResultPath
    || input.session.artifacts.redTestResultPath
    || input.session.artifacts.constraintsSnapshotPath
    || input.session.artifacts.planPath
  const openIssues = [{
    id: `${roundId}-${input.stage}`,
    title: input.reason,
    severity: input.finalAction === 'revise' ? 'high' as const : 'medium' as const,
    sourceRole: input.fromRole,
    category: input.finalAction === 'revise' ? 'quality' : 'blocked',
    evidencePath: evidencePath || input.session.artifacts.planPath,
    requiredAction: nextRoundBrief,
    status: input.finalAction === 'revise' ? 'open' as const : 'blocked' as const,
  }]
  const artifactRefs = [
    { path: roleNextRoundPath, label: 'next-round-input' },
    input.session.artifacts.repairOpenIssuesPath ? { path: input.session.artifacts.repairOpenIssuesPath, label: 'open-issues' } : undefined,
    input.session.artifacts.repairEvidencePath ? { path: input.session.artifacts.repairEvidencePath, label: 'repair-evidence' } : undefined,
    input.session.artifacts.greenTestResultPath ? { path: input.session.artifacts.greenTestResultPath, label: 'green-test-result' } : undefined,
    input.session.artifacts.redTestResultPath ? { path: input.session.artifacts.redTestResultPath, label: 'red-test-result' } : undefined,
    input.session.artifacts.constraintsSnapshotPath ? { path: input.session.artifacts.constraintsSnapshotPath, label: 'constraints-snapshot' } : undefined,
  ].filter(Boolean) as Array<{ path: string; label: string }>
  const roundResult = createRoleRoundResult({
    roundId,
    roles: input.session.roles || [],
    developmentResult: input.session.stageResults.length > 0
      ? {
        summary: input.session.stageResults[input.session.stageResults.length - 1].summary,
        artifactRefs: input.session.stageResults[input.session.stageResults.length - 1].artifacts.map((path) => ({ path })),
      }
      : undefined,
    testResult: input.stage === 'code_development'
      ? {
        status: input.finalAction === 'revise' ? 'failed' : 'blocked',
        summary: input.reason,
        artifactRefs: artifactRefs.filter((ref) => ref.label?.includes('test-result') || ref.label === 'repair-evidence'),
      }
      : undefined,
    reviewResults: [],
    arbitrationResult: {
      action: input.finalAction,
      summary: input.reason,
      artifactRefs: [{ path: roleNextRoundPath, label: 'next-round-input' }],
    },
    openIssues,
    nextRoundBrief,
    finalAction: input.finalAction,
  })

  await mkdir(roleArtifacts.roundsDir, { recursive: true })
  await writeFile(roleRoundPath, JSON.stringify(roundResult, null, 2), 'utf-8')
  await writeFile(roleOpenIssuesPath, buildLoopRoleOpenIssuesMarkdown(openIssues), 'utf-8')
  await writeFile(roleNextRoundPath, buildLoopNextRoundMarkdown({
    session: input.session,
    stage: input.stage,
    reason: input.reason,
    nextRoundBrief,
    finalAction: input.finalAction,
  }), 'utf-8')
  await appendFile(roleArtifacts.messagesPath, `${serializeRoleMessage(createRoleMessage({
    sessionId: input.session.id,
    roundId,
    fromRole: input.fromRole,
    toRole: input.toRole || 'developer',
    kind: 'next_round_input',
    summary: nextRoundBrief,
    artifactRefs,
  }))}\n`, 'utf-8')
  if (input.finalAction === 'requeue_or_blocked') {
    await appendFile(roleArtifacts.messagesPath, `${serializeRoleMessage(createRoleMessage({
      sessionId: input.session.id,
      roundId,
      fromRole: input.fromRole,
      toRole: input.toRole || 'developer',
      kind: 'blocked_for_human',
      summary: input.reason,
      artifactRefs: [{ path: roleNextRoundPath, label: 'next-round-input' }],
    }))}\n`, 'utf-8')
  }

  input.session.artifacts.roleRoundsDir = roleArtifacts.roundsDir
  input.session.artifacts.roleMessagesPath = roleArtifacts.messagesPath
  input.session.artifacts.nextRoundInputPath = roleNextRoundPath

  const knowledgeArtifacts = resolveLoopKnowledgeArtifacts(input.session)
  if (knowledgeArtifacts) {
    await updateTaskKnowledgeSummary(
      knowledgeArtifacts,
      'next-round-input',
      buildLoopNextRoundMarkdown({
        session: input.session,
        stage: input.stage,
        reason: input.reason,
        nextRoundBrief,
        finalAction: input.finalAction,
      }),
      `Next-round input updated for ${input.stage}.`
    )
  }

  input.progressObserver?.onSessionUpdate?.(input.session)
}

function buildLoopCandidates(session: LoopSession, approved: boolean, summary: string, evidencePath?: string): KnowledgeCandidate[] {
  if (approved) {
    return [{
      type: 'decision',
      title: session.goal,
      summary,
      sourceSessionId: session.id,
      evidencePath,
      status: 'candidate',
    }]
  }

  return [{
    type: 'failure-pattern',
    title: summary,
    summary,
    sourceSessionId: session.id,
    evidencePath,
    status: 'candidate',
  }]
}

function buildStagePrompt(stage: LoopStageName, session: LoopSession, tasks: LoopTask[], knowledgeContext: string): string {
  const stageTasks = tasks.filter(task => task.stage === stage)
  const taskText = stageTasks.map(task => {
    const criteria = task.successCriteria.map(item => `- ${item}`).join('\n')
    return `Task ${task.id}: ${task.title}\n${task.description}\nSuccess Criteria:\n${criteria}`
  }).join('\n\n')

  return `You are executing Magpie loop stage "${stage}".

Goal:
${session.goal}

PRD path:
${session.prdPath}

Current stage tasks:
${taskText || '- Complete this stage with best effort.'}

${knowledgeContext}

Execution requirements:
1. Make concrete progress in repository files and/or commands where needed.
2. Keep changes minimal and aligned with the goal.
3. At the end, output a concise stage report in markdown.
4. Include a section "Artifacts" with file paths touched or generated.
${stage === 'code_development' && session.tddEligible && session.redTestConfirmed
  ? '5. TDD state: red test has already been confirmed. Focus on the minimal implementation needed to satisfy that failing test.'
  : ''}

Return markdown only.`
}

function buildStagePromptWithDocuments(
  stage: LoopStageName,
  session: LoopSession,
  tasks: LoopTask[],
  knowledgeContext: string,
  documentPlan: DocumentPlan
): string {
  return [
    buildStagePrompt(stage, session, tasks, knowledgeContext).trimEnd(),
    '',
    renderDocumentPlanForStage(stage, documentPlan),
    '',
    'When you generate repository documents, follow the document routing above exactly.',
    'Return markdown only.',
  ].join('\n')
}

async function evaluateStage(
  planner: AIProvider,
  stage: LoopStageName,
  stageReport: string,
  testOutput: string
): Promise<StageEvaluation> {
  const prompt = `Evaluate this stage execution quality. Return ONLY JSON.

Stage: ${stage}
Stage report:
${stageReport}

Test output:
${testOutput || '(none)'}

JSON schema:
\`\`\`json
{
  "confidence": 0.0,
  "risks": ["..."],
  "requireHumanConfirmation": false,
  "summary": "..."
}
\`\`\``

  const messages: Message[] = [{ role: 'user', content: prompt }]
  const response = await planner.chat(messages, undefined, { disableTools: true })
  const parsed = extractJsonBlock<StageEvaluation>(response)

  if (!parsed) {
    return {
      confidence: 0.5,
      risks: ['Failed to parse evaluation JSON from planner model'],
      requireHumanConfirmation: false,
      summary: 'Evaluation parsing failed; continuing without manual gate.',
      parseFailed: true,
    }
  }

  return {
    confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    requireHumanConfirmation: parsed.requireHumanConfirmation === true,
    summary: parsed.summary || 'No summary provided.',
  }
}

function shouldGateHuman(
  runtime: LoopRuntimeConfig,
  stageSucceeded: boolean,
  evaluation: StageEvaluation
): boolean {
  if (runtime.gatePolicy === 'always') return true
  if (evaluation.requireHumanConfirmation) return true
  if (evaluation.parseFailed && stageSucceeded) return false
  if (runtime.gatePolicy === 'manual_only') return false
  if (!stageSucceeded) return true
  return evaluation.confidence < runtime.confidenceThreshold
}

function buildActionUrl(filePath: string, line: number, clickTarget: 'vscode' | 'file'): string {
  const absolute = resolve(filePath)
  const encoded = encodeURI(absolute)
  if (clickTarget === 'file') {
    return `file://${encoded}`
  }
  return `vscode://file/${encoded}:${line}`
}

function resolveClickTarget(fallback: 'vscode' | 'file', notifications: unknown): 'vscode' | 'file' {
  const data = notifications as {
    providers?: Record<string, { type?: string; click_target?: 'vscode' | 'file' }>
    routes?: Record<string, string[]>
  } | undefined

  const route = data?.routes?.human_confirmation_required || []
  for (const providerId of route) {
    const provider = data?.providers?.[providerId]
    if (provider?.type === 'macos') {
      return provider.click_target || fallback
    }
  }
  return fallback
}

async function appendObservedEvent(
  path: string,
  sessionId: string,
  payload: Record<string, unknown>,
  observer?: LoopProgressObserver
): Promise<void> {
  const event = { ts: new Date().toISOString(), ...payload }
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8')
  observer?.onEvent?.({
    sessionId,
    ...event,
  } as never)
}

async function saveLoopSessionWithObserver(
  stateManager: StateManager,
  session: LoopSession,
  observer?: LoopProgressObserver
): Promise<void> {
  await stateManager.saveLoopSession(session)
  observer?.onSessionUpdate?.(session)
}

function buildBranchName(prefix: string, cwd: string): string | null {
  const normalizedPrefix = prefix.startsWith('sch/') ? prefix : `sch/${prefix.replace(/^\/+/, '')}`
  const sanitizedPrefix = normalizedPrefix
    .replace(/[^a-zA-Z0-9/_\-.]/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^-+/, '')
    .replace(/\/-+/g, '/')
  const safePrefix = sanitizedPrefix.length > 0 ? sanitizedPrefix : 'sch'
  const finalPrefix = safePrefix.endsWith('/') ? safePrefix : `${safePrefix}/`
  const branchName = `${finalPrefix}${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)}`
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName) || branchName.length > 100) {
    return null
  }

  try {
    execFileSync('git', ['check-ref-format', '--branch', branchName], { stdio: 'pipe', cwd })
  } catch {
    return null
  }

  return branchName
}

function ensureBranch(prefix: string, cwd: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
  } catch {
    return null
  }

  const branchName = buildBranchName(prefix, cwd)
  if (!branchName) {
    return null
  }

  try {
    execFileSync('git', ['checkout', '-b', branchName], { stdio: 'pipe', cwd })
    return branchName
  } catch {
    return null
  }
}

function getCurrentBranch(cwd: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
    const branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      cwd,
    }).trim()
    if (!branchName || branchName === 'HEAD') {
      return null
    }
    return branchName
  } catch {
    return null
  }
}

function shouldReuseCurrentBranch(branchName: string | null): branchName is string {
  if (!branchName) return false
  return branchName !== 'main' && branchName !== 'master'
}

function resolveExecutionHost(prepared: LoopPreparedInput): 'foreground' | 'tmux' {
  if (prepared.host === 'tmux' || process.env.MAGPIE_EXECUTION_HOST === 'tmux') {
    return 'tmux'
  }
  return 'foreground'
}

function resolveTmuxArtifacts(): Pick<LoopSession['artifacts'], 'tmuxSession' | 'tmuxWindow' | 'tmuxPane'> {
  return {
    tmuxSession: process.env.MAGPIE_TMUX_SESSION || undefined,
    tmuxWindow: process.env.MAGPIE_TMUX_WINDOW || undefined,
    tmuxPane: process.env.MAGPIE_TMUX_PANE || undefined,
  }
}

function resolveWorktreeDirectory(cwd: string): string | null {
  if (existsSync(join(cwd, '.worktrees'))) return '.worktrees'
  if (existsSync(join(cwd, 'worktrees'))) return 'worktrees'
  return null
}

function isIgnoredPath(cwd: string, relativePath: string): boolean {
  for (const candidate of [relativePath, join(relativePath, '.magpie-ignore-probe')]) {
    try {
      execFileSync('git', ['check-ignore', candidate], { cwd, stdio: 'pipe' })
      return true
    } catch {
      continue
    }
  }

  return false
}

function ensureWorktree(prefix: string, cwd: string): WorktreeResolution {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
  } catch {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'worktree requires a git repository',
    }
  }

  const directory = resolveWorktreeDirectory(cwd)
  if (!directory) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'No worktree directory found. Create .worktrees/ or worktrees/ first.',
    }
  }

  if (!isIgnoredPath(cwd, directory)) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: `Worktree directory ${directory} is not ignored by git.`,
    }
  }

  const branchName = buildBranchName(prefix, cwd)
  if (!branchName) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'Failed to generate a valid worktree branch name.',
    }
  }

  const workspacePath = join(cwd, directory, branchName)
  try {
    execFileSync('git', ['worktree', 'add', workspacePath, '-b', branchName], { cwd, stdio: 'pipe' })
    return {
      workspaceMode: 'worktree',
      workspacePath,
      worktreeBranch: branchName,
    }
  } catch (error) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function commitIfChanged(
  stage: LoopStageName,
  cwd: string,
  provider: AIProvider,
  expectedBranch?: string,
): Promise<{ committed: boolean; reason?: string; message?: string; source?: 'ai' | 'fallback' }> {
  try {
    if (expectedBranch) {
      const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf-8',
        cwd,
      }).trim()
      if (currentBranch !== expectedBranch) {
        return {
          committed: false,
          reason: `branch_mismatch:${currentBranch}`,
        }
      }
    }

    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd }).trim()
    if (!status) {
      return {
        committed: false,
        reason: 'no_changes',
      }
    }

    execFileSync('git', ['add', '-A'], { stdio: 'pipe', cwd })
    const commitMessage = await generateAutoCommitMessage({
      cwd,
      stage,
      provider,
    })
    execFileSync('git', ['commit', '-m', commitMessage.message], { stdio: 'pipe', cwd })
    return {
      committed: true,
      message: commitMessage.message,
      source: commitMessage.source,
      ...(commitMessage.reason ? { reason: commitMessage.reason } : {}),
    }
  } catch (error) {
    return {
      committed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function attemptLoopAutoMr(
  session: LoopSession,
  runtime: LoopRuntimeConfig,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  progressObserver: LoopProgressObserver | undefined,
  prepared: LoopPreparedInput,
  runCwd: string,
): Promise<LoopMrAttemptResult | null> {
  if (!runtime.autoMr || prepared.dryRun === true || !session.artifacts.mrResultPath) {
    return null
  }

  let result: LoopMrAttemptResult

  if (!session.branchName) {
    result = {
      status: 'manual_follow_up',
      reason: 'No branch available for automatic MR creation.',
      needsHuman: true,
    }
  } else {
    result = await createLoopMr({
      cwd: runCwd,
      branchName: session.branchName,
      goal: session.goal,
    })
  }

  await writeFile(session.artifacts.mrResultPath, JSON.stringify(result, null, 2), 'utf-8')
  await appendObservedEvent(session.artifacts.eventsPath, session.id, {
    event: 'loop_auto_mr',
    status: result.status,
    ...(result.branchName ? { branch: result.branchName } : {}),
    ...(result.url ? { url: result.url } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    needsHuman: result.needsHuman,
  }, progressObserver)

  if (result.status === 'created') {
    await notificationRouter.dispatch({
      type: 'loop_auto_mr_created',
      sessionId: session.id,
      title: 'Magpie loop MR created',
      message: `开发已完成，MR 已创建：${result.url}`,
      severity: 'info',
      actionUrl: result.url,
      metadata: {
        branch: result.branchName,
        url: result.url,
      },
      dedupeKey: `loop-auto-mr-created:${session.id}`,
    })
    return result
  }

  if (result.needsHuman) {
    await notificationRouter.dispatch({
      type: 'loop_auto_mr_manual_follow_up',
      sessionId: session.id,
      title: 'Magpie loop MR needs manual follow-up',
      message: `开发已完成，但 MR 需要人工补做。原因：${result.reason || 'unknown'}`,
      severity: 'warning',
      metadata: {
        branch: result.branchName,
        reason: result.reason,
      },
      dedupeKey: `loop-auto-mr-manual:${session.id}`,
    })
  }

  return result
}

async function markSessionFailed(
  session: LoopSession,
  stage: LoopStageName,
  reason: string,
  stateManager: StateManager,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  config: MagpieConfig,
  runtime: LoopRuntimeConfig,
  runCwd: string,
  progressObserver?: LoopProgressObserver,
): Promise<LoopExecutionResult> {
  session.currentStageIndex = session.stages.indexOf(stage)
  if (session.currentStageIndex < 0) {
    session.currentStageIndex = 0
  }
  session.status = 'failed'
  session.updatedAt = new Date()
  await persistLoopNextRoundInput({
    session,
    stage,
    stageIndex: session.currentStageIndex,
    reason,
    finalAction: 'requeue_or_blocked',
    fromRole: 'architect',
    toRole: 'developer',
    progressObserver,
  })
  await updateLoopState(session, {
    currentStage: stage,
    lastReliableResult: `Stage ${stage} failed.`,
    nextAction: 'Inspect failure details and replan.',
    currentBlocker: reason,
  }, `Loop failed at stage ${stage}.`)
  await saveLoopSessionWithObserver(stateManager, session, progressObserver)
  const stageNotification = await dispatchStageNotification({
    config,
    cwd: runCwd,
    eventsPath: session.artifacts.eventsPath,
    router: notificationRouter,
    input: {
      eventType: 'stage_failed',
      sessionId: session.id,
      capability: 'loop',
      runTitle: session.goal,
      stage,
      summary: `阶段失败：${reason}`,
      blocker: reason,
      nextAction: '检查失败原因并重新规划后再继续。',
      aiRoster: buildLoopAiRoster(runtime, stage),
    },
    severity: 'error',
    metadata: { stage, reason },
    dedupeKey: `stage_failed:${session.id}:${stage}:${Date.now()}`,
  })
  await appendObservedEvent(session.artifacts.eventsPath, session.id, {
    event: 'stage_failed',
    stage,
    reason,
    occurrence: stageNotification.occurrence,
    delivered: stageNotification.dispatch?.delivered ?? 0,
    attempted: stageNotification.dispatch?.attempted ?? 0,
  }, progressObserver)
  await appendObservedEvent(session.artifacts.eventsPath, session.id, { event: 'loop_failed', stage, reason }, progressObserver)
  await finalizeLoopKnowledge(session, false, [
    '# Final Summary',
    '',
    `Loop failed at stage ${stage}.`,
    '',
    reason,
  ].join('\n'), reason, session.artifacts.eventsPath, 'Loop failed.')

  await notificationRouter.dispatch({
    type: 'loop_failed',
    sessionId: session.id,
    title: 'Magpie loop failed',
    message: `Session ${session.id} failed at stage ${stage}: ${reason}`,
    severity: 'error',
    dedupeKey: `failed:${session.id}:${stage}`,
    metadata: { reason },
  })

  return {
    status: 'failed',
    summary: `Loop failed at stage ${stage}. Session: ${session.id}. Reason: ${reason}`,
    session,
  }
}

async function finalizeLoopKnowledge(
  session: LoopSession,
  approved: boolean,
  content: string,
  summary: string,
  evidencePath: string | undefined,
  logMessage: string
): Promise<void> {
  const artifacts = resolveLoopKnowledgeArtifacts(session)
  if (!artifacts) {
    return
  }

  const candidates = buildLoopCandidates(session, approved, summary, evidencePath)
  try {
    await updateTaskKnowledgeState(artifacts, {
      currentStage: approved ? 'completed' : 'failed',
      lastReliableResult: summary,
      nextAction: approved ? 'No further action.' : 'Inspect failure details and replan.',
      currentBlocker: approved ? 'None.' : summary,
    }, `Loop state updated for ${approved ? 'completion' : 'failure'}.`)
    await writeTaskKnowledgeFinal(artifacts, content, candidates, logMessage)
    await promoteKnowledgeCandidates(session.artifacts.repoRootPath || session.artifacts.sessionDir, candidates)
  } catch {
    return
  }
}

function resolveLoopKnowledgeArtifacts(session: LoopSession): KnowledgeArtifacts | null {
  if (!session.artifacts.knowledgeSummaryDir) {
    return null
  }

  return {
    knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
    knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
    knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
    knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
    knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
  }
}

async function updateLoopState(
  session: LoopSession,
  state: Parameters<typeof updateTaskKnowledgeState>[1],
  logMessage: string
): Promise<void> {
  const artifacts = resolveLoopKnowledgeArtifacts(session)
  if (!artifacts) {
    return
  }

  await updateTaskKnowledgeState(artifacts, state, logMessage)
}

async function waitForHumanDecision(
  filePath: string,
  itemId: string,
  pollIntervalSec: number,
  maxIterations: number
): Promise<HumanConfirmationItem | null> {
  for (let i = 0; i < maxIterations; i++) {
    const item = await findHumanConfirmationDecision(filePath, itemId)
    if (item && item.decision !== 'pending') {
      return item
    }
    await sleep(pollIntervalSec * 1000)
  }

  return null
}

async function runSingleStage(
  stage: LoopStageName,
  session: LoopSession,
  tasks: LoopTask[],
  documentPlan: DocumentPlan,
  runtime: LoopRuntimeConfig,
  planner: AIProvider,
  executor: AIProvider,
  router: ReturnType<typeof createNotificationRouter>,
  waitHuman: boolean,
  dryRun: boolean,
  notificationsConfig: unknown,
  runCwd: string,
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>,
  progressObserver?: LoopProgressObserver,
): Promise<StageRunResult> {
  const stageArtifactPath = join(session.artifacts.sessionDir, `${stage}.md`)
  let stageReport = ''
  let stageSucceeded = true
  let testOutput = ''
  const knowledgeContext = session.artifacts.knowledgeSummaryDir && session.artifacts.knowledgeSchemaPath
    ? await renderKnowledgeContext({
      knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath,
      knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'index.md'),
      knowledgeLogPath: session.artifacts.knowledgeLogPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'log.md'),
      knowledgeStatePath: session.artifacts.knowledgeStatePath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'state.json'),
      knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
      knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'candidates.json'),
    }, runCwd)
    : ''

  if (dryRun) {
    stageReport = `# Dry Run\n\nStage ${stage} skipped due to --dry-run.`
  } else {
    const stagePrompt = buildStagePromptWithDocuments(stage, session, tasks, knowledgeContext, documentPlan)
    const progressWrites: Array<Promise<void>> = []
    const response = await executor.chat([{ role: 'user', content: stagePrompt }], undefined, {
      onProgress: (event) => {
        progressWrites.push(appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: 'provider_progress',
          stage,
          provider: event.provider,
          progressType: event.kind,
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.details ? { details: event.details } : {}),
        }, progressObserver))
      },
    })
    await Promise.all(progressWrites)
    stageReport = response

    if (stage === 'unit_mock_test') {
      const unit = runSafeCommand(runCwd, runtime.commands.unitTest, {
        safety: commandSafety,
        interactive: process.stdin.isTTY && process.stdout.isTTY,
      })
      const mock = runOptionalCommand(
        runCwd,
        runtime.commands.mockTest,
        'Skipped: no mock test command configured.',
        commandSafety
      )
      stageSucceeded = unit.passed && mock.passed
      testOutput = [
        `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
        `## Mock Test (${mock.commandLabel})\n${mock.output}`,
      ].join('\n\n')
    }

    if (stage === 'integration_test') {
      const integration = runSafeCommand(runCwd, runtime.commands.integrationTest, {
        safety: commandSafety,
        interactive: process.stdin.isTTY && process.stdout.isTTY,
      })
      stageSucceeded = integration.passed
      testOutput = `## Integration Test (${runtime.commands.integrationTest})\n${integration.output}`
    }

    stageReport = mergeStageReportWithVerification(stageReport, testOutput)
    await mkdir(dirname(stageArtifactPath), { recursive: true })
    await writeFile(stageArtifactPath, stageReport, 'utf-8')
  }

  const evaluation = await evaluateStage(planner, stage, stageReport, testOutput)
  const gateHuman = shouldGateHuman(runtime, stageSucceeded, evaluation)

  const stageResult: LoopStageResult = {
    stage,
    success: stageSucceeded,
    confidence: evaluation.confidence,
    summary: evaluation.summary,
    risks: evaluation.risks,
    retryCount: 0,
    artifacts: existsSync(stageArtifactPath) ? [stageArtifactPath] : [],
    timestamp: new Date(),
  }

  if (!gateHuman) {
    return {
      stageResult,
      paused: false,
      failed: !stageSucceeded,
      stageReport,
      testOutput,
    }
  }

  const confirmationItem: HumanConfirmationItem = {
    id: generateId(),
    sessionId: session.id,
    stage,
    status: 'pending',
    decision: 'pending',
    rationale: '',
    reason: evaluation.risks.join('; ') || 'Low confidence or failed stage execution',
    artifacts: stageResult.artifacts,
    nextAction: stageSucceeded ? 'Review risk and approve to continue' : 'Fix stage and approve rerun',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const clickTarget = resolveClickTarget('vscode', notificationsConfig)
  const lineNumber = await appendHumanConfirmationItem(session.artifacts.humanConfirmationPath, confirmationItem)
  const actionUrl = buildActionUrl(session.artifacts.humanConfirmationPath, lineNumber, clickTarget)

  session.humanConfirmations.push(confirmationItem)

  const event: NotificationEvent = {
    type: 'human_confirmation_required',
    sessionId: session.id,
    title: `Magpie Loop需要人工确认 (${stage})`,
    message: confirmationItem.reason,
    severity: 'warning',
    actionUrl,
    dedupeKey: `${session.id}:${confirmationItem.id}`,
    metadata: {
      stage,
      file: session.artifacts.humanConfirmationPath,
      line: lineNumber,
    },
  }

  const dispatch = await router.dispatch(event)
  await appendObservedEvent(session.artifacts.eventsPath, session.id, {
    event: event.type,
    stage,
    actionUrl,
    delivered: dispatch.delivered,
    attempted: dispatch.attempted,
  }, progressObserver)

  if (!waitHuman) {
    return {
      stageResult,
      paused: true,
      failed: false,
      stageReport,
      testOutput,
    }
  }

  const decided = await waitForHumanDecision(
    session.artifacts.humanConfirmationPath,
    confirmationItem.id,
    runtime.pollIntervalSec,
    runtime.maxIterations
  )

  if (!decided) {
    return {
      stageResult,
      paused: true,
      failed: false,
      stageReport,
      testOutput,
    }
  }

  confirmationItem.decision = decided.decision
  confirmationItem.status = decided.decision === 'approved' ? 'approved' : decided.decision
  confirmationItem.rationale = decided.rationale
  confirmationItem.updatedAt = new Date()

  if (decided.decision === 'approved') {
    return {
      stageResult,
      paused: false,
      failed: !stageSucceeded,
      stageReport,
      testOutput,
    }
  }

  if (decided.decision === 'rejected' || decided.decision === 'revise') {
    if (!existsSync(stageArtifactPath)) {
      await mkdir(dirname(stageArtifactPath), { recursive: true })
      await writeFile(stageArtifactPath, stageReport || `# Stage ${stage}`, 'utf-8')
    }

    let finalEval = evaluation
    let finalSucceeded = stageSucceeded
    let finalTestOutput = testOutput
    const maxRetries = Math.max(0, runtime.retriesPerStage)

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const replanPrompt = `Human rejected stage ${stage}. Retry ${attempt}/${maxRetries}. Rerun this stage with this rationale:\n${decided.rationale || '(none provided)'}\n\nGoal: ${session.goal}`
      const replanOutput = await planner.chat([{ role: 'user', content: replanPrompt }])
      await appendFile(stageArtifactPath, `\n\n## Human Replan Guidance (Retry ${attempt})\n${replanOutput}\n`, 'utf-8')

      const retried = await executor.chat([{
        role: 'user',
        content: `${buildStagePromptWithDocuments(stage, session, tasks, knowledgeContext, documentPlan)}\n\nAdditional guidance:\n${replanOutput}`,
      }])

      if (stage === 'unit_mock_test') {
        const unit = runSafeCommand(runCwd, runtime.commands.unitTest, {
          safety: commandSafety,
          interactive: process.stdin.isTTY && process.stdout.isTTY,
        })
        const mock = runOptionalCommand(
          runCwd,
          runtime.commands.mockTest,
          'Skipped: no mock test command configured.',
          commandSafety
        )
        finalSucceeded = unit.passed && mock.passed
        finalTestOutput = [
          `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
          `## Mock Test (${mock.commandLabel})\n${mock.output}`,
        ].join('\n\n')
      } else if (stage === 'integration_test') {
        const integration = runSafeCommand(runCwd, runtime.commands.integrationTest, {
          safety: commandSafety,
          interactive: process.stdin.isTTY && process.stdout.isTTY,
        })
        finalSucceeded = integration.passed
        finalTestOutput = `## Integration Test (${runtime.commands.integrationTest})\n${integration.output}`
      } else {
        finalSucceeded = true
      }

      stageReport = mergeStageReportWithVerification(retried, finalTestOutput)
      await appendFile(stageArtifactPath, `\n\n## Retry Execution (${attempt})\n${stageReport}\n`, 'utf-8')

      finalEval = await evaluateStage(planner, stage, stageReport, finalTestOutput)
      stageResult.retryCount = attempt
      stageResult.confidence = finalEval.confidence
      stageResult.summary = finalEval.summary
      stageResult.risks = finalEval.risks
      stageResult.success = finalSucceeded

      const passed = finalSucceeded
        && finalEval.confidence >= runtime.confidenceThreshold
        && !finalEval.requireHumanConfirmation
      if (passed) {
        return {
          stageResult,
          paused: false,
          failed: false,
          stageReport,
          testOutput: finalTestOutput,
        }
      }
    }

    stageResult.confidence = finalEval.confidence
    stageResult.summary = finalEval.summary
    stageResult.risks = finalEval.risks
    stageResult.success = false

    return {
      stageResult,
      paused: false,
      failed: true,
      stageReport,
      testOutput: finalTestOutput,
    }
  }

  return {
    stageResult,
    paused: true,
    failed: false,
    stageReport,
    testOutput,
  }
}

async function continueSession(
  session: LoopSession,
  prepared: LoopPreparedInput,
  documentPlan: DocumentPlan,
  runCwd: string,
  timeoutTier: ComplexityTier,
  runtime: LoopRuntimeConfig,
  config: MagpieConfig,
  planner: AIProvider,
  executor: AIProvider,
  autoCommitProvider: AIProvider,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  notificationsConfig: unknown,
  stateManager: StateManager,
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>,
  progressObserver?: LoopProgressObserver,
): Promise<LoopExecutionResult> {
  for (let i = session.currentStageIndex; i < session.stages.length; i++) {
    const stage = session.stages[i]
    const timeoutMs = applyLoopProviderTimeouts(planner, executor, runtime, stage, timeoutTier)
    const resumedExecutionRetry = stage === 'code_development'
      && session.currentLoopState === 'retrying_execution'
      && session.lastReliablePoint === 'test_result_recorded'
      && Boolean(session.artifacts.greenTestResultPath)
    if (stage === 'code_development') {
      const constraints = await loadLoopConstraints(session.artifacts.repoRootPath || runCwd)
      if (constraints) {
        session.artifacts.constraintsSnapshotPath = await createConstraintsSnapshot(session.artifacts.sessionDir, constraints)
      }

      const constraintCheck = evaluatePlanningConstraints({
        stage,
        goal: session.goal,
        stageTasks: session.plan.filter((task) => task.stage === stage),
        constraints: constraints || {
          version: 1,
          sourcePrdPath: session.prdPath,
          sourceTrdPath: '',
          generatedAt: new Date().toISOString(),
          rules: [],
        },
      })

      session.constraintsValidated = true
      session.constraintCheckStatus = constraintCheck.status
      if (!resumedExecutionRetry) {
        session.lastReliablePoint = 'constraints_validated'
      }
      session.lastFailureReason = constraintCheck.reasons.join('; ') || undefined
      session.updatedAt = new Date()

      await updateLoopState(session, {
        currentStage: stage,
        lastReliableResult: constraintCheck.status === 'pass'
          ? 'Constraint checks passed before code development.'
          : 'Constraint checks require attention before code development.',
        nextAction: constraintCheck.status === 'pass'
          ? `Execute ${stage}.`
          : 'Revise the plan or constraints before continuing.',
        currentBlocker: constraintCheck.reasons.join('; ') || 'None.',
      }, `Constraint checks completed for ${stage}.`)
      await saveLoopSessionWithObserver(stateManager, session, progressObserver)

      if (constraintCheck.status !== 'pass') {
        session.currentStageIndex = i
        session.status = 'paused_for_human'
        session.updatedAt = new Date()
        await persistLoopNextRoundInput({
          session,
          stage,
          stageIndex: i,
          reason: session.lastFailureReason || constraintCheck.reasons.join('; ') || 'constraints need revision',
          finalAction: 'requeue_or_blocked',
          fromRole: 'architect',
          toRole: 'developer',
          progressObserver,
        })
        await saveLoopSessionWithObserver(stateManager, session, progressObserver)
        await appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: constraintCheck.status === 'blocked' ? 'constraints_blocked' : 'constraints_revision_required',
          stage,
          reasons: constraintCheck.reasons,
          matchedRuleIds: constraintCheck.matchedRuleIds,
          ...(session.artifacts.constraintsSnapshotPath
            ? { snapshotPath: session.artifacts.constraintsSnapshotPath }
            : {}),
        }, progressObserver)

        return {
          status: 'paused',
          summary: `Loop paused before ${stage}: ${constraintCheck.reasons.join('; ') || 'constraints need revision'}`,
          session,
        }
      }

      const tdd = assessTddEligibility({
        goal: session.goal,
        stageTasks: session.plan.filter((task) => task.stage === stage),
      })
      session.tddEligible = tdd.eligible
      session.updatedAt = new Date()
      await saveLoopSessionWithObserver(stateManager, session, progressObserver)

      if (tdd.eligible && !session.redTestConfirmed) {
        session.artifacts.tddTargetPath = await createTddTarget({
          sessionDir: session.artifacts.sessionDir,
          goal: session.goal,
          stageTasks: session.plan.filter((task) => task.stage === stage),
        })
        await appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: 'tdd_target_created',
          stage,
          targetPath: session.artifacts.tddTargetPath,
        }, progressObserver)

        if (prepared.dryRun !== true) {
          const redPrompt = [
            `You are preparing the red-test phase for stage "${stage}".`,
            '',
            `Goal: ${session.goal}`,
            '',
            'Before implementation, create or refine the failing test only.',
            'Do not implement production code in this step.',
            session.artifacts.tddTargetPath ? `TDD target: ${session.artifacts.tddTargetPath}` : '',
          ].filter(Boolean).join('\n')
          await executor.chat([{ role: 'user', content: redPrompt }], undefined)
        }

        const redTestRun = runStructuredTestCommand(
          runCwd,
          runtime.commands.unitTest,
          commandSafety
        )
        session.artifacts.redTestResultPath = await recordRedTestResult(session.artifacts.sessionDir, {
          command: redTestRun.command,
          startedAt: redTestRun.startedAt,
          finishedAt: redTestRun.finishedAt,
          exitCode: redTestRun.exitCode,
          status: redTestRun.status,
          output: redTestRun.output,
          confirmed: redTestRun.status === 'failed' && redTestRun.failureKind === 'quality',
          blocked: redTestRun.blocked,
          failureKind: redTestRun.failureKind,
          firstError: redTestRun.firstError,
        })

        if (redTestRun.status === 'passed') {
          session.redTestConfirmed = false
          session.currentStageIndex = i
          session.status = 'paused_for_human'
          session.lastFailureReason = 'Red test unexpectedly passed before implementation.'
          session.updatedAt = new Date()
          await persistLoopNextRoundInput({
            session,
            stage,
            stageIndex: i,
            reason: session.lastFailureReason,
            finalAction: 'requeue_or_blocked',
            fromRole: 'tester',
            toRole: 'developer',
            progressObserver,
          })
          await saveLoopSessionWithObserver(stateManager, session, progressObserver)
          await appendObservedEvent(session.artifacts.eventsPath, session.id, {
            event: 'red_test_not_confirmed',
            stage,
            resultPath: session.artifacts.redTestResultPath,
          }, progressObserver)

          return {
            status: 'paused',
            summary: `Loop paused before ${stage}: red test unexpectedly passed.`,
            session,
          }
        }

        if (redTestRun.failureKind === 'execution') {
          const repairState = advanceRepairState({
            failureKind: 'execution',
            repairAttemptCount: session.repairAttemptCount || 0,
            executionRetryCount: session.executionRetryCount || 0,
          })
          const summary = `Red test could not be established: ${redTestRun.firstError || 'test command failed before a real assertion failure was observed'}`
          const repairArtifacts = await writeRepairArtifacts({
            sessionDir: session.artifacts.sessionDir,
            attemptNumber: repairState.executionRetryCount,
            summary,
            classifiedResult: redTestRun,
          })

          session.currentLoopState = repairState.currentLoopState
          session.repairAttemptCount = repairState.repairAttemptCount
          session.executionRetryCount = repairState.executionRetryCount
          session.currentStageIndex = i
          session.status = 'paused_for_human'
          session.lastFailureReason = summary
          session.artifacts.repairOpenIssuesPath = repairArtifacts.openIssuesPath
          session.artifacts.repairEvidencePath = repairArtifacts.evidencePath
          session.updatedAt = new Date()
          await persistLoopNextRoundInput({
            session,
            stage,
            stageIndex: i,
            reason: summary,
            finalAction: 'requeue_or_blocked',
            fromRole: 'tester',
            toRole: 'developer',
            progressObserver,
          })
          await saveLoopSessionWithObserver(stateManager, session, progressObserver)
          await appendObservedEvent(session.artifacts.eventsPath, session.id, {
            event: 'red_test_execution_retry_required',
            stage,
            summary,
            currentLoopState: session.currentLoopState,
            resultPath: session.artifacts.redTestResultPath,
            openIssuesPath: repairArtifacts.openIssuesPath,
            evidencePath: repairArtifacts.evidencePath,
          }, progressObserver)

          return {
            status: 'paused',
            summary,
            session,
          }
        }

        session.redTestConfirmed = true
        session.lastReliablePoint = 'red_test_confirmed'
        session.updatedAt = new Date()
        await saveLoopSessionWithObserver(stateManager, session, progressObserver)
        await appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: 'red_test_confirmed',
          stage,
          resultPath: session.artifacts.redTestResultPath,
        }, progressObserver)
      }
    }

    const reuseImplementationFromRetry = resumedExecutionRetry

    let stageRun: StageRunResult | null = null
    let completionStageResult: LoopStageResult | null = null

    if (!reuseImplementationFromRetry) {
      await updateLoopState(session, {
        currentStage: stage,
        lastReliableResult: `Preparing stage ${stage}.`,
        nextAction: `Execute ${stage}.`,
        currentBlocker: 'Stage in progress.',
      }, `Loop state moved to ${stage}.`)
      const enteredNotification = await dispatchStageNotification({
        config,
        cwd: runCwd,
        eventsPath: session.artifacts.eventsPath,
        router: notificationRouter,
        input: {
          eventType: 'stage_entered',
          sessionId: session.id,
          capability: 'loop',
          runTitle: session.goal,
          stage,
          summary: `开始执行 ${stage} 阶段。`,
          nextAction: nextLoopAction(session, i),
          aiRoster: buildLoopAiRoster(runtime, stage),
        },
        severity: 'info',
        metadata: { stage, timeoutMs },
        dedupeKey: `stage_entered:${session.id}:${stage}:${Date.now()}`,
      })
      await appendObservedEvent(session.artifacts.eventsPath, session.id, {
        event: 'stage_entered',
        stage,
        timeoutMs,
        occurrence: enteredNotification.occurrence,
        delivered: enteredNotification.dispatch?.delivered ?? 0,
        attempted: enteredNotification.dispatch?.attempted ?? 0,
      }, progressObserver)
      try {
        stageRun = await runSingleStage(
          stage,
          session,
          session.plan,
          documentPlan,
          runtime,
          planner,
          executor,
          notificationRouter,
          prepared.waitHuman !== false,
          prepared.dryRun === true,
          notificationsConfig,
          runCwd,
          commandSafety,
          progressObserver,
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return markSessionFailed(session, stage, reason, stateManager, notificationRouter, config, runtime, runCwd, progressObserver)
      }

      completionStageResult = stageRun.stageResult
      session.stageResults.push(stageRun.stageResult)
      session.updatedAt = new Date()
      if (stage === 'code_development' && session.tddEligible && session.redTestConfirmed) {
        session.lastReliablePoint = 'implementation_generated'
        await saveLoopSessionWithObserver(stateManager, session, progressObserver)
      }
    } else {
      completionStageResult = [...session.stageResults].reverse().find((item) => item.stage === stage) || null
      await appendObservedEvent(session.artifacts.eventsPath, session.id, {
        event: 'execution_retry_resumed',
        stage,
        resultPath: session.artifacts.greenTestResultPath,
      }, progressObserver)
    }

    if (!reuseImplementationFromRetry && session.artifacts.knowledgeSummaryDir && stageRun) {
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, `stage-${stage}`, renderStageKnowledge(stageRun), `Stage ${stage} summary updated.`)
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, 'open-issues', renderOpenIssues(stageRun), `Stage ${stage} open issues updated.`)
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, 'evidence', renderEvidence(stageRun), `Stage ${stage} evidence updated.`)
    }
    if (!reuseImplementationFromRetry && stageRun) {
      await updateLoopState(session, {
        currentStage: stage,
        lastReliableResult: stageRun.stageResult.summary,
        nextAction: stageRun.paused
          ? 'Wait for human confirmation.'
          : session.stages[i + 1]
            ? `Start ${session.stages[i + 1]}.`
            : 'Finalize loop output.',
        currentBlocker: stageRun.paused
          ? 'Waiting for human confirmation.'
          : stageRun.stageResult.success
            ? 'None.'
            : 'Stage did not complete successfully.',
      }, `Loop state refreshed after ${stage}.`)
    }

    if (stageRun?.paused) {
      session.currentStageIndex = i
      session.status = 'paused_for_human'
      await persistLoopNextRoundInput({
        session,
        stage,
        stageIndex: i,
        reason: completionStageResult?.summary || `Stage ${stage} paused for human confirmation.`,
        finalAction: 'requeue_or_blocked',
        fromRole: 'architect',
        toRole: 'developer',
        progressObserver,
      })
      await saveLoopSessionWithObserver(stateManager, session, progressObserver)
      const pausedNotification = await dispatchStageNotification({
        config,
        cwd: runCwd,
        eventsPath: session.artifacts.eventsPath,
        router: notificationRouter,
        input: {
          eventType: 'stage_paused',
          sessionId: session.id,
          capability: 'loop',
          runTitle: session.goal,
          stage,
          summary: `阶段 ${stage} 已暂停，等待人工确认。`,
          blocker: '等待人工确认。',
          nextAction: '人工确认后恢复当前阶段。',
          aiRoster: buildLoopAiRoster(runtime, stage),
        },
        severity: 'warning',
        metadata: { stage },
        dedupeKey: `stage_paused:${session.id}:${stage}:${Date.now()}`,
      })
      await appendObservedEvent(session.artifacts.eventsPath, session.id, {
        event: 'stage_paused',
        stage,
        occurrence: pausedNotification.occurrence,
        delivered: pausedNotification.dispatch?.delivered ?? 0,
        attempted: pausedNotification.dispatch?.attempted ?? 0,
      }, progressObserver)
      await appendObservedEvent(session.artifacts.eventsPath, session.id, { event: 'loop_paused', stage }, progressObserver)

      await notificationRouter.dispatch({
        type: 'loop_paused',
        sessionId: session.id,
        title: 'Magpie loop paused',
        message: `Session ${session.id} paused at stage ${stage}`,
        severity: 'warning',
        dedupeKey: `paused:${session.id}:${stage}`,
      })

      return {
        status: 'paused',
        summary: `Loop paused for human confirmation at stage ${stage}. Session: ${session.id}`,
        session,
      }
    }

    if (stageRun?.failed) {
      return markSessionFailed(
        session,
        stage,
        stageRun.stageResult.summary || 'Stage execution reported failure',
        stateManager,
        notificationRouter,
        config,
        runtime,
        runCwd,
        progressObserver
      )
    }

    if (stage === 'code_development' && session.tddEligible && session.redTestConfirmed) {
      while (true) {
        const greenTestResult = runStructuredTestCommand(
          runCwd,
          runtime.commands.unitTest,
          commandSafety
        )
        session.artifacts.greenTestResultPath = await recordStructuredTestResult(
          session.artifacts.sessionDir,
          'green-test-result.json',
          greenTestResult
        )
        session.lastReliablePoint = 'test_result_recorded'
        session.updatedAt = new Date()
        await saveLoopSessionWithObserver(stateManager, session, progressObserver)

        if (greenTestResult.status === 'passed' || !greenTestResult.failureKind) {
          break
        }

        const repairState = advanceRepairState({
          failureKind: greenTestResult.failureKind,
          repairAttemptCount: session.repairAttemptCount || 0,
          executionRetryCount: session.executionRetryCount || 0,
        })
        const attemptNumber = greenTestResult.failureKind === 'quality'
          ? repairState.repairAttemptCount
          : repairState.executionRetryCount
        const summary = buildTestFailureSummary(greenTestResult, '需要继续修复')
        const repairArtifacts = await writeRepairArtifacts({
          sessionDir: session.artifacts.sessionDir,
          attemptNumber,
          summary,
          classifiedResult: greenTestResult,
        })

        session.currentLoopState = repairState.currentLoopState
        session.repairAttemptCount = repairState.repairAttemptCount
        session.executionRetryCount = repairState.executionRetryCount
        session.lastFailureReason = summary
        session.artifacts.repairOpenIssuesPath = repairArtifacts.openIssuesPath
        session.artifacts.repairEvidencePath = repairArtifacts.evidencePath
        session.updatedAt = new Date()
        await saveLoopSessionWithObserver(stateManager, session, progressObserver)
        await appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: greenTestResult.failureKind === 'quality' ? 'repair_required' : 'execution_retry_required',
          stage,
          summary,
          currentLoopState: session.currentLoopState,
          resultPath: session.artifacts.greenTestResultPath,
          openIssuesPath: repairArtifacts.openIssuesPath,
          evidencePath: repairArtifacts.evidencePath,
          blockedForHuman: repairState.blockedForHuman,
        }, progressObserver)

        if (repairState.blockedForHuman) {
          session.status = 'paused_for_human'
          session.updatedAt = new Date()
          await persistLoopNextRoundInput({
            session,
            stage,
            stageIndex: i,
            reason: summary,
            finalAction: greenTestResult.failureKind === 'quality' ? 'revise' : 'requeue_or_blocked',
            fromRole: 'tester',
            toRole: 'developer',
            progressObserver,
          })
          await saveLoopSessionWithObserver(stateManager, session, progressObserver)
          return {
            status: 'paused',
            summary,
            session,
          }
        }

        if (greenTestResult.failureKind === 'quality') {
          if (prepared.dryRun !== true) {
            await executor.chat([{
              role: 'user',
              content: buildRepairPrompt(stage, session, summary),
            }], undefined)
          }
          continue
        }

        await appendObservedEvent(session.artifacts.eventsPath, session.id, {
          event: 'execution_retry_restarted',
          stage,
          retryCount: session.executionRetryCount,
        }, progressObserver)
      }
    }

    const completedNotification = await dispatchStageNotification({
      config,
      cwd: runCwd,
      eventsPath: session.artifacts.eventsPath,
      router: notificationRouter,
      input: {
        eventType: 'stage_completed',
        sessionId: session.id,
        capability: 'loop',
        runTitle: session.goal,
        stage,
        summary: completionStageResult?.summary || `阶段 ${stage} 已完成。`,
        blocker: completionStageResult?.risks[0],
        nextAction: nextLoopAction(session, i),
        aiRoster: buildLoopAiRoster(runtime, stage),
      },
      severity: 'info',
      metadata: {
        stage,
        success: completionStageResult?.success ?? true,
        confidence: completionStageResult?.confidence ?? 1,
        retryCount: completionStageResult?.retryCount ?? 0,
      },
      dedupeKey: `stage_completed:${session.id}:${stage}:${Date.now()}`,
    })
    await appendObservedEvent(session.artifacts.eventsPath, session.id, {
      event: 'stage_completed',
      stage,
      occurrence: completedNotification.occurrence,
      delivered: completedNotification.dispatch?.delivered ?? 0,
      attempted: completedNotification.dispatch?.attempted ?? 0,
      success: completionStageResult?.success ?? true,
      confidence: completionStageResult?.confidence ?? 1,
    }, progressObserver)

    session.currentStageIndex = i + 1
    if (runtime.autoCommit && session.branchName && (completionStageResult?.success ?? true) && prepared.dryRun !== true) {
      const commitResult = await commitIfChanged(stage, runCwd, autoCommitProvider, session.branchName)
      await appendObservedEvent(session.artifacts.eventsPath, session.id, {
        event: 'auto_commit',
        stage,
        committed: commitResult.committed,
        ...(commitResult.message ? { message: commitResult.message } : {}),
        ...(commitResult.source ? { source: commitResult.source } : {}),
        ...(commitResult.reason ? { reason: commitResult.reason } : {}),
      }, progressObserver)
    }

    await saveLoopSessionWithObserver(stateManager, session, progressObserver)
  }

  session.status = 'completed'
  session.currentLoopState = 'completed'
  session.lastReliablePoint = 'completed'
  session.updatedAt = new Date()
  await saveLoopSessionWithObserver(stateManager, session, progressObserver)
  await appendObservedEvent(session.artifacts.eventsPath, session.id, { event: 'loop_completed' }, progressObserver)
  const mrResult = await attemptLoopAutoMr(
    session,
    runtime,
    notificationRouter,
    progressObserver,
    prepared,
    runCwd,
  )

  const finalSummaryLines = [
    '# Final Summary',
    '',
    `Loop completed successfully for ${session.goal}.`,
    '',
    `Stages completed: ${session.stages.join(', ')}`,
  ]
  let finalReliableResult = `Loop completed successfully for ${session.goal}.`
  let returnSummary = `Loop completed successfully. Session: ${session.id}`

  if (mrResult?.status === 'created') {
    finalSummaryLines.push('', `MR created: ${mrResult.url}`)
    finalReliableResult = `Loop completed successfully for ${session.goal}. MR created: ${mrResult.url}`
    returnSummary = `Loop completed successfully. MR created: ${mrResult.url}`
  } else if (mrResult?.needsHuman) {
    finalSummaryLines.push('', `MR needs manual follow-up: ${mrResult.reason || 'unknown reason'}`)
    finalReliableResult = `Loop completed successfully for ${session.goal}. MR needs manual follow-up.`
    returnSummary = 'Loop completed successfully. MR 需要人工补做。'
  }

  await finalizeLoopKnowledge(
    session,
    true,
    finalSummaryLines.join('\n'),
    finalReliableResult,
    session.artifacts.planPath,
    'Loop completed successfully.'
  )

  await notificationRouter.dispatch({
    type: 'loop_completed',
    sessionId: session.id,
    title: 'Magpie loop completed',
    message: `Session ${session.id} completed all stages.`,
    severity: 'info',
    dedupeKey: `completed:${session.id}`,
  })

  return {
    status: 'completed',
    summary: returnSummary,
    session,
  }
}

async function executeRun(prepared: LoopPreparedInput, ctx: CapabilityContext): Promise<LoopExecutionResult> {
  if (!prepared.goal) {
    throw new Error('loop run requires a goal')
  }
  if (!prepared.prdPath) {
    throw new Error('loop run requires --prd path')
  }

  const config = loadConfig(ctx.configPath)
  const loopRuntime = resolveLoopConfig(config.capabilities.loop)
  const executionHost = resolveExecutionHost(prepared)
  const commandSafety = buildCommandSafetyConfig(config.capabilities.safety)
  const routingDecision = isRoutingEnabled(config) && prepared.goal && prepared.prdPath
    ? createRoutingDecision({
      goal: prepared.goal,
      prdContent: await readFile(prepared.prdPath, 'utf-8').catch(() => ''),
      overrideTier: prepared.complexity,
      config,
    })
    : undefined
  if (routingDecision) {
    loopRuntime.plannerTool = routingDecision.planning.tool
    loopRuntime.plannerModel = routingDecision.planning.model || routingDecision.planning.tool || loopRuntime.plannerModel
    loopRuntime.plannerAgent = routingDecision.planning.agent
    loopRuntime.executorTool = routingDecision.execution.tool
    loopRuntime.executorModel = routingDecision.execution.model || routingDecision.execution.tool || loopRuntime.executorModel
    loopRuntime.executorAgent = routingDecision.execution.agent
  }
  applyLoopRoleBindingOverrides(config.capabilities.loop, loopRuntime)
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)
  const planningRouter = createPlanningRouter(config.integrations.planning)
  const planningItemKey = prepared.planningItemKey
    || extractPlanningItemKey(`${prepared.goal}\n${prepared.prdPath}`)

  const planner = createConfiguredProvider({
    logicalName: 'capabilities.loop.planner',
    tool: loopRuntime.plannerTool,
    model: loopRuntime.plannerModel,
    agent: loopRuntime.plannerAgent,
  }, config)
  const executor = createConfiguredProvider({
    logicalName: 'capabilities.loop.executor',
    tool: loopRuntime.executorTool,
    model: loopRuntime.executorModel,
    agent: loopRuntime.executorAgent,
  }, config)
  const autoCommitProvider = createConfiguredProvider(resolveAutoCommitProviderBinding({
    autoCommitModel: loopRuntime.autoCommitModel,
    executorTool: loopRuntime.executorTool,
    executorModel: loopRuntime.executorModel,
    executorAgent: loopRuntime.executorAgent,
  }), config)

  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()
  const progressObserver = getLoopProgressObserver(ctx)

  const sessionId = process.env.MAGPIE_SESSION_ID?.trim() || generateId()
  const sessionDir = getRepoSessionDir(ctx.cwd, 'loop', sessionId)
  const eventsPath = join(sessionDir, 'events.jsonl')
  const planPath = join(sessionDir, 'plan.json')
  const mrResultPath = join(sessionDir, 'mr-result.json')
  const routingDecisionPath = join(sessionDir, 'routing-decision.json')
  const roleArtifacts = getRoleArtifactPaths(sessionDir)
  const roleRoster = buildLoopRoleRoster(loopRuntime)

  await mkdir(sessionDir, { recursive: true })
  let branchName: string | undefined
  let workspaceMode: 'current' | 'worktree' = 'current'
  let workspacePath = ctx.cwd
  let worktreeFailureReason: string | undefined
  const shouldUseWorktree = prepared.dryRun !== true && (routingDecision?.tier || prepared.complexity) === 'complex'
  if (shouldUseWorktree) {
    const worktree = ensureWorktree(loopRuntime.autoBranchPrefix, ctx.cwd)
    workspaceMode = worktree.workspaceMode
    workspacePath = worktree.workspacePath
    branchName = worktree.worktreeBranch
    worktreeFailureReason = worktree.failureReason
  }
  const seededDocumentPlan = ctx.metadata?.documentPlan as DocumentPlan | undefined
  const { plan: documentPlan, planPath: documentPlanPath } = await generateDocumentPlan({
    repoRoot: workspacePath,
    sessionDir,
    capability: 'loop',
    sessionId,
    goal: prepared.goal,
    prdPath: prepared.prdPath,
    stages: loopRuntime.stages,
    provider: planner,
    seedPlan: seededDocumentPlan,
  })
  await mkdir(roleArtifacts.roundsDir, { recursive: true })
  const knowledgeArtifacts = await createTaskKnowledge({
    sessionDir,
    capability: 'loop',
    sessionId,
    title: prepared.goal.slice(0, 60),
    goal: prepared.goal,
  })
  if (routingDecision) {
    await writeFile(routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
  }

  const planningContext = await planningRouter.createPlanContext({
    itemKey: planningItemKey,
    title: prepared.goal,
  })
  const planningContextBlock = buildPlanningContextBlock(planningContext)
  const tasks = await generateLoopPlan(
    planner,
    prepared.goal,
    prepared.prdPath,
    loopRuntime.stages,
    planningContextBlock
  )
  await writeFile(planPath, JSON.stringify(tasks, null, 2), 'utf-8')
  await writeFile(roleArtifacts.rolesPath, JSON.stringify(roleRoster, null, 2), 'utf-8')
  const initialRoleMessage = roleRoster.some((role) => role.roleId === 'architect')
    && roleRoster.some((role) => role.roleId === 'developer')
    ? `${serializeRoleMessage(createRoleMessage({
      sessionId,
      roundId: 'round-1',
      fromRole: 'architect',
      toRole: 'developer',
      kind: 'plan_request',
      summary: `Loop plan generated for ${tasks.length} task(s).`,
      artifactRefs: [{ path: planPath, label: 'loop-plan' }],
    }))}\n`
    : ''
  await writeFile(roleArtifacts.messagesPath, initialRoleMessage, 'utf-8')
  await updateTaskKnowledgeSummary(
    knowledgeArtifacts,
    'plan',
    renderPlanSummary(tasks),
    'Loop plan summary generated.'
  )
  await updateTaskKnowledgeState(knowledgeArtifacts, {
    currentStage: 'planning',
    lastReliableResult: 'Loop plan summary generated.',
    nextAction: tasks[0] ? `Start ${tasks[0].stage}.` : 'Finalize loop output.',
    currentBlocker: tasks.length > 0 ? 'Waiting for stage execution.' : 'No planned stages available.',
  }, 'Loop planning state initialized.')
  await planningRouter.syncPlanArtifact({
    projectKey: planningContext?.projectKey,
    itemKey: planningContext?.itemKey || planningItemKey,
    title: prepared.goal,
    body: [
      `Goal: ${prepared.goal}`,
      `PRD: ${resolve(prepared.prdPath)}`,
      '',
      'Plan:',
      JSON.stringify(tasks, null, 2),
    ].join('\n'),
  })

  let reusedCurrentBranch = false
  if (loopRuntime.autoCommit && prepared.dryRun !== true && workspaceMode !== 'worktree' && !worktreeFailureReason) {
    const currentBranch = loopRuntime.reuseCurrentBranch
      ? getCurrentBranch(ctx.cwd)
      : null
    if (shouldReuseCurrentBranch(currentBranch)) {
      branchName = currentBranch
      reusedCurrentBranch = true
    } else {
      branchName = ensureBranch(loopRuntime.autoBranchPrefix, ctx.cwd) || undefined
    }
  }
  const humanConfirmationPath = resolve(workspacePath, loopRuntime.humanConfirmationFile)

  const session: LoopSession = {
    id: sessionId,
    title: prepared.goal.slice(0, 60),
    goal: prepared.goal,
    prdPath: resolve(prepared.prdPath),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'running',
    currentStageIndex: 0,
    stages: loopRuntime.stages,
    plan: tasks,
    stageResults: [],
    humanConfirmations: [],
    roles: roleRoster,
    branchName,
    routingTier: routingDecision?.tier,
    selectedComplexity: prepared.complexity || routingDecision?.tier,
    artifacts: {
      sessionDir,
      repoRootPath: ctx.cwd,
      workspaceMode,
      workspacePath,
      ...(branchName ? { worktreeBranch: branchName } : {}),
      executionHost,
      ...resolveTmuxArtifacts(),
      eventsPath,
      planPath,
      humanConfirmationPath,
      mrResultPath,
      documentPlanPath,
      roleRosterPath: roleArtifacts.rolesPath,
      roleMessagesPath: roleArtifacts.messagesPath,
      roleRoundsDir: roleArtifacts.roundsDir,
      ...knowledgeArtifacts,
      ...(routingDecision ? { routingDecisionPath } : {}),
    },
  }

  await saveLoopSessionWithObserver(stateManager, session, progressObserver)
  await appendObservedEvent(eventsPath, session.id, { event: 'loop_started', goal: prepared.goal }, progressObserver)
  if (workspaceMode === 'worktree') {
    await appendObservedEvent(eventsPath, session.id, {
      event: 'worktree_created',
      workspacePath,
      branch: branchName,
    }, progressObserver)
  }
  if (worktreeFailureReason) {
    await appendObservedEvent(eventsPath, session.id, {
      event: 'worktree_failed',
      reason: worktreeFailureReason,
    }, progressObserver)
    return markSessionFailed(
      session,
      session.stages[0] || 'prd_review',
      worktreeFailureReason,
      stateManager,
      notificationRouter,
      config,
      loopRuntime,
      workspacePath,
      progressObserver
    )
  }
  if (reusedCurrentBranch && branchName) {
    await appendObservedEvent(eventsPath, session.id, {
      event: 'auto_commit_branch_reused',
      branch: branchName,
    }, progressObserver)
  }
  if (loopRuntime.autoCommit && prepared.dryRun !== true && !branchName) {
    ctx.logger.warn('[loop] Auto-commit disabled because branch creation failed; changes will remain on the current branch.')
    await appendObservedEvent(eventsPath, session.id, {
      event: 'auto_commit_disabled',
      reason: 'branch_creation_failed',
    }, progressObserver)
  }

  return continueSession(
    session,
    prepared,
    documentPlan,
    workspacePath,
    prepared.complexity || routingDecision?.tier || 'standard',
    loopRuntime,
    config,
    planner,
    executor,
    autoCommitProvider,
    notificationRouter,
    config.integrations.notifications,
    stateManager,
    commandSafety,
    progressObserver
  )
}

async function executeResume(prepared: LoopPreparedInput, ctx: CapabilityContext): Promise<LoopExecutionResult> {
  if (!prepared.sessionId) {
    throw new Error('loop resume requires a session id')
  }

  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()
  const progressObserver = getLoopProgressObserver(ctx)

  const all = await stateManager.listLoopSessions()
  const matches = all.filter((item) => item.id === prepared.sessionId || item.id.startsWith(prepared.sessionId || ''))

  if (matches.length === 0) {
    throw new Error(`No loop session found matching "${prepared.sessionId}"`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple loop sessions match "${prepared.sessionId}", use full id`)
  }

  const session = matches[0]

  if (session.status === 'completed') {
    return {
      status: 'completed',
      summary: `Session ${session.id} already completed.`,
      session,
    }
  }

  if (session.status === 'failed') {
    return {
      status: 'failed',
      summary: `Session ${session.id} is failed. Start a new run or manually fix and resume from artifacts.`,
      session,
    }
  }

  const config = loadConfig(ctx.configPath)
  const loopRuntime = resolveLoopConfig(config.capabilities.loop)
  const commandSafety = buildCommandSafetyConfig(config.capabilities.safety)
  const resumeComplexity = resolveSessionComplexityTier(session, prepared.complexity)
  const routingDecision = isRoutingEnabled(config)
    ? createRoutingDecision({
      goal: session.goal,
      prdContent: await readFile(session.prdPath, 'utf-8').catch(() => ''),
      overrideTier: resumeComplexity,
      config,
    })
    : undefined
  if (routingDecision) {
    loopRuntime.plannerTool = routingDecision.planning.tool
    loopRuntime.plannerModel = routingDecision.planning.model || routingDecision.planning.tool || loopRuntime.plannerModel
    loopRuntime.plannerAgent = routingDecision.planning.agent
    loopRuntime.executorTool = routingDecision.execution.tool
    loopRuntime.executorModel = routingDecision.execution.model || routingDecision.execution.tool || loopRuntime.executorModel
    loopRuntime.executorAgent = routingDecision.execution.agent
    session.routingTier = routingDecision.tier
    session.selectedComplexity = resumeComplexity || routingDecision.tier
    if (session.artifacts.routingDecisionPath) {
      await writeFile(session.artifacts.routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
    }
  } else if (resumeComplexity) {
    session.selectedComplexity = resumeComplexity
  }
  applyLoopRoleBindingOverrides(config.capabilities.loop, loopRuntime)
  const roleArtifacts = getRoleArtifactPaths(session.artifacts.sessionDir)
  const roleRoster = buildLoopRoleRoster(loopRuntime)
  await mkdir(roleArtifacts.roundsDir, { recursive: true })
  await writeFile(roleArtifacts.rolesPath, JSON.stringify(roleRoster, null, 2), 'utf-8')
  try {
    await readFile(roleArtifacts.messagesPath, 'utf-8')
  } catch {
    await writeFile(roleArtifacts.messagesPath, '', 'utf-8')
  }
  session.roles = roleRoster
  session.artifacts.roleRosterPath = roleArtifacts.rolesPath
  session.artifacts.roleMessagesPath = roleArtifacts.messagesPath
  session.artifacts.roleRoundsDir = roleArtifacts.roundsDir
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)
  const planningRouter = createPlanningRouter(config.integrations.planning)
  const planningItemKey = prepared.planningItemKey
    || extractPlanningItemKey(`${session.goal}\n${session.prdPath}`)

  const planner = createConfiguredProvider({
    logicalName: 'capabilities.loop.planner',
    tool: loopRuntime.plannerTool,
    model: loopRuntime.plannerModel,
    agent: loopRuntime.plannerAgent,
  }, config)
  const executor = createConfiguredProvider({
    logicalName: 'capabilities.loop.executor',
    tool: loopRuntime.executorTool,
    model: loopRuntime.executorModel,
    agent: loopRuntime.executorAgent,
  }, config)
  const autoCommitProvider = createConfiguredProvider(resolveAutoCommitProviderBinding({
    autoCommitModel: loopRuntime.autoCommitModel,
    executorTool: loopRuntime.executorTool,
    executorModel: loopRuntime.executorModel,
    executorAgent: loopRuntime.executorAgent,
  }), config)
  const planningContext = await planningRouter.createPlanContext({
    itemKey: planningItemKey,
    title: session.goal,
  })
  const planningContextBlock = buildPlanningContextBlock(planningContext)

  if (!session.plan || session.plan.length === 0) {
    session.plan = await generateLoopPlan(
      planner,
      session.goal,
      session.prdPath,
      session.stages,
      planningContextBlock
    )
    await writeFile(session.artifacts.planPath, JSON.stringify(session.plan, null, 2), 'utf-8')
  }

  const { plan: documentPlan, planPath: documentPlanPath } = await generateDocumentPlan({
    repoRoot: session.artifacts.workspacePath || ctx.cwd,
    sessionDir: session.artifacts.sessionDir,
    capability: 'loop',
    sessionId: session.id,
    goal: session.goal,
    prdPath: session.prdPath,
    stages: session.stages,
    provider: planner,
    existingPlanPath: session.artifacts.documentPlanPath,
  })
  session.artifacts.documentPlanPath = documentPlanPath

  const resumeCheckpointError = validateResumeCheckpoint(session)
  if (resumeCheckpointError) {
    session.status = 'paused_for_human'
    session.currentLoopState = 'blocked_for_human'
    session.lastFailureReason = resumeCheckpointError
    session.updatedAt = new Date()
    await persistLoopNextRoundInput({
      session,
      stage: session.stages[session.currentStageIndex] || session.stages[0] || 'prd_review',
      stageIndex: session.currentStageIndex,
      reason: resumeCheckpointError,
      finalAction: 'requeue_or_blocked',
      fromRole: 'architect',
      toRole: 'developer',
      progressObserver,
    })
    await saveLoopSessionWithObserver(stateManager, session, progressObserver)
    await appendObservedEvent(session.artifacts.eventsPath, session.id, {
      event: 'resume_blocked_invalid_checkpoint',
      stage: session.stages[session.currentStageIndex] || 'unknown',
      reason: resumeCheckpointError,
    }, progressObserver)

    return {
      status: 'paused',
      summary: resumeCheckpointError,
      session,
    }
  }

  if (session.status === 'paused_for_human') {
    const resumedNotification = await dispatchStageNotification({
      config,
      cwd: session.artifacts.workspacePath || ctx.cwd,
      eventsPath: session.artifacts.eventsPath,
      router: notificationRouter,
      input: {
        eventType: 'stage_resumed',
        sessionId: session.id,
        capability: 'loop',
        runTitle: session.goal,
        stage: session.stages[session.currentStageIndex] || 'unknown',
        summary: `恢复执行 ${session.stages[session.currentStageIndex] || 'current'} 阶段。`,
        nextAction: '继续当前阶段并处理上一次暂停留下的问题。',
        aiRoster: buildLoopAiRoster(
          loopRuntime,
          session.stages[session.currentStageIndex] || session.stages[0] || 'prd_review'
        ),
      },
      severity: 'info',
      metadata: { stageIndex: session.currentStageIndex },
      dedupeKey: `stage_resumed:${session.id}:${session.currentStageIndex}:${Date.now()}`,
    })
    await appendObservedEvent(session.artifacts.eventsPath, session.id, {
      event: 'stage_resumed',
      stage: session.stages[session.currentStageIndex] || 'unknown',
      occurrence: resumedNotification.occurrence,
      delivered: resumedNotification.dispatch?.delivered ?? 0,
      attempted: resumedNotification.dispatch?.attempted ?? 0,
    }, progressObserver)
    await notificationRouter.dispatch({
      type: 'loop_resumed',
      sessionId: session.id,
      title: 'Magpie loop resumed',
      message: `Session ${session.id} resumed from stage index ${session.currentStageIndex}.`,
      severity: 'info',
      dedupeKey: `resumed:${session.id}:${session.currentStageIndex}`,
    })
  }

  session.status = 'running'
  session.updatedAt = new Date()
  await saveLoopSessionWithObserver(stateManager, session, progressObserver)

  return continueSession(
    session,
    prepared,
    documentPlan,
    session.artifacts.workspacePath || ctx.cwd,
    resumeComplexity || 'standard',
    loopRuntime,
    config,
    planner,
    executor,
    autoCommitProvider,
    notificationRouter,
    config.integrations.notifications,
    stateManager,
    commandSafety,
    progressObserver
  )
}

async function executeList(ctx: CapabilityContext): Promise<LoopExecutionResult> {
  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()
  const sessions = await stateManager.listLoopSessions()

  return {
    status: 'listed',
    summary: `Found ${sessions.length} loop session(s).`,
    sessions,
  }
}

export async function executeLoop(
  prepared: LoopPreparedInput,
  ctx: CapabilityContext
): Promise<LoopExecutionResult> {
  if (prepared.mode === 'list') {
    return executeList(ctx)
  }

  if (prepared.mode === 'resume') {
    return executeResume(prepared, ctx)
  }

  return executeRun(prepared, ctx)
}

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import YAML from 'yaml'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { createCapabilityContext } from '../../../../core/capability/context.js'
import { runCapability } from '../../../../core/capability/runner.js'
import { createRoutingDecision, escalateRoutingDecision, getEscalationReason, isRoutingEnabled } from '../../../routing/index.js'
import { discussCapability } from '../../../discuss/index.js'
import { loopCapability } from '../../../loop/index.js'
import { unitTestEvalCapability } from '../../../quality/unit-test-eval/index.js'
import { reviewCapability } from '../../../review/index.js'
import { extractJsonBlock } from '../../../../trd/renderer.js'
import { issueFixCapability } from '../../issue-fix/index.js'
import {
  appendWorkflowEvent,
  generateWorkflowId,
  persistWorkflowSession,
  sessionDirFor,
} from '../../shared/runtime.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import type { MagpieConfigV2, ModelRouteBinding, RoutingDecision } from '../../../../platform/config/types.js'
import type { MergedIssue } from '../../../../core/debate/types.js'
import type { HarnessCycle, HarnessPreparedInput, HarnessResult, HarnessStage } from '../types.js'
import { selectHarnessProviders } from './provider-selection.js'
import { getHarnessProgressObserver } from '../progress.js'
import {
  createTaskKnowledge,
  promoteKnowledgeCandidates,
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

interface DecisionJson {
  decision?: 'approved' | 'revise'
  rationale?: string
  requiredActions?: string[]
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
  return [
    '# Evidence',
    '',
    `- Review output: ${cycle.reviewOutputPath}`,
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

function cloneConfig(config: MagpieConfigV2): MagpieConfigV2 {
  return JSON.parse(JSON.stringify(config)) as MagpieConfigV2
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
  const reviewerIds = modelsExplicit
    ? ensureHarnessReviewers(config, models)
    : routingDecision?.reviewerIds
      ? [...routingDecision.reviewerIds]
      : ensureHarnessReviewers(config, models)

  if (!modelsExplicit) {
    applyHarnessReviewerPrompts(config, reviewerIds)
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
  } else {
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
  testsPassed: boolean,
  testOutput: string
): string {
  const topIssues = issues.slice(0, 10).map((issue, index) => {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
    return `${index + 1}. [${issue.severity}] ${issue.title} @ ${location}\n${issue.description}`
  }).join('\n\n')

  return [
    `Harness adjudication cycle ${cycle}.`,
    '',
    `Unit tests passed: ${testsPassed ? 'yes' : 'no'}`,
    '',
    'Blocking findings from adversarial review:',
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
  testOutput: string,
  decision: DecisionJson | null
): string {
  const issueLines = issues.slice(0, 10).map((issue, index) => {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
    return `${index + 1}. [${issue.severity}] ${issue.title} @ ${location}\n${issue.description}`
  }).join('\n\n')

  const actions = (decision?.requiredActions || []).map((item, index) => `${index + 1}. ${item}`).join('\n')

  return [
    `Harness auto-fix cycle ${cycle}.`,
    '',
    'Please apply the minimum safe changes to resolve these blocking items.',
    '',
    'Blocking items:',
    issueLines || '- none',
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

  const adjudicationTopic = buildAdjudicationTopic(cycle, blockingIssues, testsPassed, testOutput)
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
  const approved = isApproved(decision, blockingIssues.length, testsPassed)

  const cycleResult: HarnessCycle = {
    cycle,
    reviewOutputPath,
    adjudicationOutputPath,
    unitTestEvalPath,
    issueCount: allIssues.length,
    blockingIssueCount: blockingIssues.length,
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
      blockingIssueCount: blockingIssues.length,
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
    issue: buildIssueFixPrompt(cycle, blockingIssues, testOutput, decision),
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
  const progressObserver = getHarnessProgressObserver(ctx)
  const sessionId = generateWorkflowId('harness')
  const sessionDir = sessionDirFor('harness', sessionId)
  const roundsPath = join(sessionDir, 'rounds.json')
  const harnessConfigPath = join(sessionDir, 'harness.config.yaml')
  const providerSelectionPath = join(sessionDir, 'provider-selection.json')
  const routingDecisionPath = join(sessionDir, 'routing-decision.json')
  const eventsPath = join(sessionDir, 'events.jsonl')

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

  type HarnessSession = NonNullable<HarnessResult['session']>
  type HarnessSessionPatch = Omit<Partial<HarnessSession>, 'artifacts'> & {
    artifacts?: Partial<HarnessSession['artifacts']>
  }

  let session: HarnessSession = {
    id: sessionId,
    capability: 'harness' as const,
    title: prepared.goal.slice(0, 80),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'in_progress' as const,
    currentStage: 'queued' as HarnessStage,
    summary: 'Harness workflow queued.',
    artifacts: {
      repoRootPath: ctx.cwd,
      harnessConfigPath,
      roundsPath,
      providerSelectionPath,
      routingDecisionPath,
      eventsPath,
      ...knowledgeArtifacts,
    },
  }

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
    await persistWorkflowSession(session)
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
    await appendWorkflowEvent('harness', sessionId, event)
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

  const transitionStage = async (
    stage: HarnessStage,
    summary: string,
    eventType = 'stage_changed',
    details?: Record<string, unknown>
  ): Promise<void> => {
    await persistSession({
      currentStage: stage,
      summary,
    })
    await appendEvent(eventType, {
      stage,
      summary,
      details,
    })
  }

  await persistSession()
  await appendEvent('workflow_started', {
    stage: 'queued',
    summary: 'Harness workflow started.',
  })

  let routingDecision = isRoutingEnabled(config)
    ? createRoutingDecision({
      goal: prepared.goal,
      prdContent: await readFile(prepared.prdPath, 'utf-8').catch(() => ''),
      overrideTier: prepared.complexity,
      config,
    })
    : undefined

  let { config: harnessConfig, reviewerIds } = applyHarnessConfigOverrides(
    config,
    prepared.models,
    prepared.modelsExplicit,
    routingDecision
  )
  const providerSelection = selectHarnessProviders(harnessConfig, reviewerIds, resolve(ctx.cwd), ctx.now)
  await writeFile(providerSelectionPath, JSON.stringify(providerSelection.record, null, 2), 'utf-8')
  await writeFile(harnessConfigPath, YAML.stringify(harnessConfig), 'utf-8')
  if (routingDecision) {
    await writeFile(routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
  }

  if (providerSelection.record.decision === 'fallback_failed') {
    const summary = `Harness failed before development started: Kiro fallback unavailable. ${providerSelection.record.kiroCheck.reason || ''}`.trim()
    const candidates = buildHarnessCandidates(prepared.goal, sessionId, false, summary, providerSelectionPath)
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
    })
    await appendEvent('workflow_failed', {
      stage: 'failed',
      summary,
    })
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
  })

  await transitionStage('developing', 'Running loop development stage.')

  const loopResult = await runCapability(loopCapability, {
    mode: 'run',
    goal: prepared.goal,
    prdPath: prepared.prdPath,
    waitHuman: false,
  }, harnessCtx)

  if (loopResult.result.status !== 'completed') {
    const summary = 'Harness failed during loop development stage.'
    const candidates = buildHarnessCandidates(prepared.goal, sessionId, false, summary, eventsPath)
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
      artifacts: {
        ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
      },
    })
    await appendEvent('workflow_failed', {
      stage: 'failed',
      summary,
    })
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

  await persistSession({
    artifacts: {
      ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
    },
  })
  await updateTaskKnowledgeSummary(
    knowledgeArtifacts,
    'plan',
    [
      buildHarnessPlanSummary(prepared.goal),
      '',
      loopResult.result.session?.id ? `Loop session: ${loopResult.result.session.id}` : 'Loop session: unavailable',
    ].join('\n'),
    'Harness linked loop session.'
  )

  const testCommand = prepared.testCommand || config.capabilities.loop?.commands?.unit_test || 'npm run test:run'
  const cycles: HarnessCycle[] = []
  let approved = false

  try {
    for (let cycle = 1; cycle <= prepared.maxCycles; cycle++) {
      await transitionStage('reviewing', `Running review cycle ${cycle}.`, 'stage_changed', { cycle })
      const cycleRun = await runCycle(
        cycle,
        resolve(ctx.cwd),
        harnessConfigPath,
        reviewerIds,
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
    await persistSession({
      status: 'failed',
      currentStage: 'failed',
      summary,
    })
    await appendEvent('workflow_failed', {
      stage: 'failed',
      summary,
      details: { error: message },
    })
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
  await persistSession({
    status: approved ? 'completed' : 'failed',
    currentStage: approved ? 'completed' : 'failed',
    summary,
  })
  await appendEvent(approved ? 'workflow_completed' : 'workflow_failed', {
    stage: approved ? 'completed' : 'failed',
    summary,
    details: {
      totalCycles: cycles.length,
    },
  })
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

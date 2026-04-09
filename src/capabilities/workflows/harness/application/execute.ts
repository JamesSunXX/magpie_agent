import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import YAML from 'yaml'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { createCapabilityContext } from '../../../../core/capability/context.js'
import { runCapability } from '../../../../core/capability/runner.js'
import { discussCapability } from '../../../discuss/index.js'
import { loopCapability } from '../../../loop/index.js'
import { unitTestEvalCapability } from '../../../quality/unit-test-eval/index.js'
import { reviewCapability } from '../../../review/index.js'
import { extractJsonBlock } from '../../../../trd/renderer.js'
import { issueFixCapability } from '../../issue-fix/index.js'
import {
  generateWorkflowId,
  persistWorkflowSession,
  sessionDirFor,
} from '../../shared/runtime.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import type { MagpieConfigV2 } from '../../../../platform/config/types.js'
import type { MergedIssue } from '../../../../core/debate/types.js'
import type { HarnessCycle, HarnessPreparedInput, HarnessResult } from '../types.js'
import { selectHarnessProviders } from './provider-selection.js'

const BLOCKING_SEVERITIES = new Set(['critical', 'high'])

interface DecisionJson {
  decision?: 'approved' | 'revise'
  rationale?: string
  requiredActions?: string[]
}

function cloneConfig(config: MagpieConfigV2): MagpieConfigV2 {
  return JSON.parse(JSON.stringify(config)) as MagpieConfigV2
}

function ensureHarnessReviewers(config: MagpieConfigV2, models: string[]): string[] {
  const prompts = [
    'You are a strict release gate reviewer. Prioritize correctness, security, and missing tests. Focus on blocking risks first.',
    'You are an adversarial reviewer. Challenge weak claims from other reviewers, find blind spots, and verify if issues are real and severe.',
  ]

  const reviewerIds: string[] = []
  const reviewers = config.reviewers || {}

  models.forEach((model, index) => {
    const reviewerId = `harness-${index + 1}`
    reviewers[reviewerId] = {
      model,
      prompt: prompts[index] || prompts[prompts.length - 1],
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

function applyHarnessConfigOverrides(
  baseConfig: MagpieConfigV2,
  models: string[]
): { config: MagpieConfigV2; reviewerIds: string[] } {
  const config = cloneConfig(baseConfig)
  const reviewerIds = ensureHarnessReviewers(config, models)

  const loopConfig = config.capabilities.loop || {}
  config.capabilities.loop = {
    ...loopConfig,
    human_confirmation: {
      ...(loopConfig.human_confirmation || {}),
      gate_policy: 'manual_only',
    },
  }

  const issueFixConfig = config.capabilities.issue_fix || {}
  config.capabilities.issue_fix = {
    ...issueFixConfig,
    planner_model: models[0],
    executor_model: models[Math.min(1, models.length - 1)] || models[0],
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
): Promise<{ cycleResult: HarnessCycle; approved: boolean }> {
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
    return { cycleResult, approved: true }
  }

  const issueFix = await runCapability(issueFixCapability, {
    issue: buildIssueFixPrompt(cycle, blockingIssues, testOutput, decision),
    apply: true,
    verifyCommand: testCommand,
  }, cycleCtx)

  cycleResult.issueFixSessionId = issueFix.result.session?.id
  return { cycleResult, approved: false }
}

export async function executeHarness(
  prepared: HarnessPreparedInput,
  ctx: CapabilityContext
): Promise<HarnessResult> {
  const config = loadConfig(ctx.configPath)
  const sessionId = generateWorkflowId('harness')
  const sessionDir = sessionDirFor('harness', sessionId)
  const roundsPath = join(sessionDir, 'rounds.json')
  const harnessConfigPath = join(sessionDir, 'harness.config.yaml')
  const providerSelectionPath = join(sessionDir, 'provider-selection.json')

  await mkdir(sessionDir, { recursive: true })

  const { config: harnessConfig, reviewerIds } = applyHarnessConfigOverrides(config, prepared.models)
  const providerSelection = selectHarnessProviders(harnessConfig, reviewerIds, resolve(ctx.cwd), ctx.now)
  await writeFile(providerSelectionPath, JSON.stringify(providerSelection.record, null, 2), 'utf-8')
  await writeFile(harnessConfigPath, YAML.stringify(harnessConfig), 'utf-8')

  if (providerSelection.record.decision === 'fallback_failed') {
    const failedSession = {
      id: sessionId,
      capability: 'harness' as const,
      title: prepared.goal.slice(0, 80),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'failed' as const,
      summary: `Harness failed before development started: Kiro fallback unavailable. ${providerSelection.record.kiroCheck.reason || ''}`.trim(),
      artifacts: {
        harnessConfigPath,
        roundsPath,
        providerSelectionPath,
      },
    }
    await persistWorkflowSession(failedSession)

    return {
      status: 'failed',
      session: failedSession,
    }
  }

  const harnessCtx = createCapabilityContext({
    cwd: ctx.cwd,
    configPath: harnessConfigPath,
  })

  const loopResult = await runCapability(loopCapability, {
    mode: 'run',
    goal: prepared.goal,
    prdPath: prepared.prdPath,
    waitHuman: false,
  }, harnessCtx)

  if (loopResult.result.status !== 'completed') {
    const failedSession = {
      id: sessionId,
      capability: 'harness' as const,
      title: prepared.goal.slice(0, 80),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'failed' as const,
      summary: 'Harness failed during loop development stage.',
      artifacts: {
        harnessConfigPath,
        roundsPath,
        providerSelectionPath,
        ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
      },
    }
    await persistWorkflowSession(failedSession)

    return {
      status: 'failed',
      session: failedSession,
    }
  }

  const testCommand = prepared.testCommand || config.capabilities.loop?.commands?.unit_test || 'npm run test:run'
  const cycles: HarnessCycle[] = []
  let approved = false

  try {
    for (let cycle = 1; cycle <= prepared.maxCycles; cycle++) {
      const cycleRun = await runCycle(
        cycle,
        resolve(ctx.cwd),
        harnessConfigPath,
        reviewerIds,
        prepared.reviewRounds,
        testCommand,
        sessionDir,
      )
      cycles.push(cycleRun.cycleResult)
      await writeFile(roundsPath, JSON.stringify(cycles, null, 2), 'utf-8')
      if (cycleRun.approved) {
        approved = true
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failedSession = {
      id: sessionId,
      capability: 'harness' as const,
      title: prepared.goal.slice(0, 80),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'failed' as const,
      summary: `Harness failed during review cycle: ${message}`,
      artifacts: {
        harnessConfigPath,
        roundsPath,
        providerSelectionPath,
        ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
      },
    }
    await persistWorkflowSession(failedSession)
    return { status: 'failed', session: failedSession }
  }

  const completedSession = {
    id: sessionId,
    capability: 'harness' as const,
    title: prepared.goal.slice(0, 80),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: approved ? 'completed' as const : 'failed' as const,
    summary: approved
      ? `Harness approved after ${cycles.length} cycle(s).`
      : `Harness failed after ${cycles.length} cycle(s) without approval.`,
    artifacts: {
      harnessConfigPath,
      roundsPath,
      providerSelectionPath,
      ...(loopResult.result.session ? { loopSessionId: loopResult.result.session.id } : {}),
    },
  }
  await persistWorkflowSession(completedSession)

  return {
    status: approved ? 'completed' : 'failed',
    session: completedSession,
  }
}

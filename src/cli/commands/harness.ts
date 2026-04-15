import { readFile, readdir } from 'fs/promises'
import { normalize, resolve } from 'path'
import { Command, InvalidArgumentError } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import {
  appendWorkflowEvent,
  isRecoverableHarnessSession,
  isRecoverableLoopSession,
  listWorkflowSessions,
  loadWorkflowSession,
  persistWorkflowSession,
} from '../../capabilities/workflows/shared/runtime.js'
import {
  enqueueHarnessSession,
  isHarnessServerRunning,
} from '../../capabilities/workflows/harness-server/runtime.js'
import {
  createHarnessGraphArtifact,
  loadHarnessGraphArtifact,
  persistHarnessGraphArtifact,
  reconcileHarnessGraphArtifact,
  recordHarnessGraphApprovalDecision,
  type HarnessGraphApprovalGate,
  type HarnessGraphArtifact,
  type HarnessGraphNode,
  type HarnessGraphNodeInput,
} from '../../capabilities/workflows/harness-server/graph.js'
import type {
  HarnessInput,
  HarnessPreparedInput,
  HarnessPriority,
  HarnessResult,
  HarnessSummary,
} from '../../capabilities/workflows/harness/types.js'
import type { WorkflowSession } from '../../capabilities/workflows/shared/runtime.js'
import { createHarnessProgressReporter, followHarnessEventStream, formatHarnessEventLine } from './harness-progress.js'
import { printKnowledgeInspectView, printKnowledgeSummary } from './knowledge.js'
import { printDocumentPlanSummary } from './document-plan.js'
import type { KnowledgeState } from '../../knowledge/runtime.js'
import type { ExecutionHost } from '../../platform/integrations/operations/types.js'
import { formatLocalDateTime } from '../../shared/utils/time.js'
import { launchMagpieInTmux } from './tmux-launch.js'
import { StateManager } from '../../state/state-manager.js'
import { applyLoopConfirmationDecision, type ConfirmationDecisionOptions } from './human-confirmation-actions.js'

interface HarnessCommandOptions {
  config?: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
  complexity?: HarnessInput['complexity']
  host?: ExecutionHost
  priority?: HarnessPriority
}

interface PersistedHarnessResumeEvidence {
  input?: HarnessInput
  configPath?: string
  runtime?: {
    lastReliablePoint?: string
  }
}

interface HarnessRoundViewOptions {
  cycle?: number
  node?: string
}

interface HarnessApprovalCommandOptions {
  node?: string
  gate?: string
  by?: string
  note?: string
}

interface HarnessConfirmCommandOptions extends ConfirmationDecisionOptions {
  config?: string
}

interface HarnessRoundSummary {
  roles?: Array<{
    roleId: string
    roleType: string
    displayName?: string
    binding?: { tool?: string; model?: string; agent?: string }
  }>
  reviewResults?: Array<{
    reviewerRoleId: string
    summary: string
  }>
  arbitrationResult?: {
    summary?: string
  }
  finalAction?: string
  nextRoundBrief?: string
}

interface HarnessRoundIndexEntry {
  cycle: number
  finalAction: string
}

class MissingHarnessCycleError extends Error {
  constructor(readonly cycle: number) {
    super(`Harness cycle not found: ${cycle}`)
    this.name = 'MissingHarnessCycleError'
  }
}

class MissingHarnessGraphNodeError extends Error {
  constructor(readonly nodeId: string) {
    super(`Harness graph node not found: ${nodeId}`)
    this.name = 'MissingHarnessGraphNodeError'
  }
}

class MissingHarnessGraphError extends Error {
  constructor(readonly sessionId: string) {
    super(`Harness graph not found for session: ${sessionId}`)
    this.name = 'MissingHarnessGraphError'
  }
}

const HARNESS_PRIORITIES = ['interactive', 'high', 'normal', 'background'] as const
const FAILURE_RECOVERY_REQUIREMENT_PATH = 'docs/plans/2026-04-14-harness-loop-failure-recovery.md'
const FAILURE_RECOVERY_EXECUTION_PLAN_PATH = 'docs/plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md'
const FAILURE_RECOVERY_STAGE_NODES: HarnessGraphNodeInput[] = [
  {
    id: 'loop-recovery',
    title: 'Loop recovery',
    goal: 'Make loop keep failed-but-usable development runs resumable.',
    type: 'feature',
    stageDocumentPath: 'docs/plans/2026-04-14-loop-recovery-stage.md',
  },
  {
    id: 'harness-recovery',
    title: 'Harness recovery',
    goal: 'Make harness treat recoverable inner loop failures as resumable workflow state.',
    type: 'integration',
    dependencies: ['loop-recovery'],
    stageDocumentPath: 'docs/plans/2026-04-14-harness-recovery-stage.md',
  },
  {
    id: 'submit-reconnect',
    title: 'Submit reconnect',
    goal: 'Reconnect submit to the latest recoverable matching session.',
    type: 'feature',
    dependencies: ['harness-recovery'],
    stageDocumentPath: 'docs/plans/2026-04-14-submit-reconnect-stage.md',
  },
  {
    id: 'provider-session-reuse',
    title: 'Provider session reuse',
    goal: 'Restore provider session continuity per role on resume.',
    type: 'integration',
    dependencies: ['harness-recovery'],
    stageDocumentPath: 'docs/plans/2026-04-14-provider-session-reuse-stage.md',
  },
  {
    id: 'verification-and-compat',
    title: 'Verification and compatibility',
    goal: 'Finish regression, compatibility, and artifact-preservation checks.',
    type: 'validation',
    dependencies: ['submit-reconnect', 'provider-session-reuse'],
    stageDocumentPath: 'docs/plans/2026-04-14-verification-and-compat-stage.md',
  },
]

function parseHarnessPriority(value: string): HarnessPriority {
  if ((HARNESS_PRIORITIES as readonly string[]).includes(value)) {
    return value as HarnessPriority
  }
  throw new InvalidArgumentError(`Priority must be one of: ${HARNESS_PRIORITIES.join(', ')}`)
}

function parseHarnessCycle(value: string): number {
  const cycle = Number.parseInt(value, 10)
  if (!Number.isFinite(cycle) || cycle < 1) {
    throw new InvalidArgumentError('Cycle must be a positive integer')
  }
  return cycle
}

function slugifyHarnessGraphId(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'harness-session'
}

function buildQueuedHarnessGraph(goal: string, prdPath: string): HarnessGraphArtifact {
  const normalizedPrdPath = normalizeComparablePrdPath(prdPath)
  const isFailureRecoveryPlan = [
    FAILURE_RECOVERY_REQUIREMENT_PATH,
    FAILURE_RECOVERY_EXECUTION_PLAN_PATH,
  ].some((candidate) => normalizeComparablePrdPath(candidate) === normalizedPrdPath)

  const graph = createHarnessGraphArtifact({
    graphId: slugifyHarnessGraphId(goal),
    title: goal,
    goal,
    sourceRequirementPath: isFailureRecoveryPlan ? FAILURE_RECOVERY_REQUIREMENT_PATH : prdPath,
    nodes: isFailureRecoveryPlan
      ? FAILURE_RECOVERY_STAGE_NODES.map((node) => ({
          ...node,
          dependencies: node.dependencies ? [...node.dependencies] : undefined,
        }))
      : [
          {
            id: 'deliverable',
            title: 'Deliver requirement',
            goal,
            type: 'feature',
          },
        ],
  })

  return reconcileHarnessGraphArtifact(graph)
}

function normalizeComparablePrdPath(prdPath: string): string {
  return normalize(resolve(process.cwd(), prdPath))
}

function mergeHarnessResumeInput(
  persisted: HarnessInput | undefined,
  submitted: HarnessInput
): HarnessInput {
  if (!persisted) {
    return submitted
  }

  const samePrd = normalizeComparablePrdPath(persisted.prdPath) === normalizeComparablePrdPath(submitted.prdPath)
  return {
    goal: submitted.goal,
    prdPath: samePrd ? persisted.prdPath : submitted.prdPath,
    maxCycles: submitted.maxCycles ?? persisted.maxCycles,
    reviewRounds: submitted.reviewRounds ?? persisted.reviewRounds,
    testCommand: submitted.testCommand ?? persisted.testCommand,
    models: submitted.models ?? persisted.models,
    complexity: submitted.complexity ?? persisted.complexity,
    host: submitted.host ?? persisted.host,
    priority: submitted.priority ?? persisted.priority,
  }
}

function legacyHarnessKnowledgeState(session: NonNullable<Awaited<ReturnType<typeof loadWorkflowSession>>>): Partial<KnowledgeState> {
  if (session.status === 'completed') {
    return {
      currentStage: 'completed',
      nextAction: 'No further action.',
      currentBlocker: 'None.',
      lastReliableResult: session.summary,
    }
  }

  if (session.status === 'failed') {
    return {
      currentStage: 'failed',
      nextAction: 'Inspect failure details and replan.',
      currentBlocker: session.summary,
      lastReliableResult: session.summary,
    }
  }

  if (session.status === 'blocked') {
    return {
      currentStage: session.currentStage || 'developing',
      nextAction: '处理人工确认后恢复当前阶段。',
      currentBlocker: session.summary,
      lastReliableResult: session.summary,
    }
  }

  return {
    currentStage: session.currentStage || 'in_progress',
    nextAction: session.currentStage === 'reviewing' ? 'Resume the current review cycle.' : 'Resume the harness workflow.',
    currentBlocker: 'Legacy session has no persisted state card.',
    lastReliableResult: session.summary,
  }
}

interface LoopActivitySnapshot {
  timestamp: string
  line: string
  stage?: string
}

interface LoopMrSnapshot {
  line: string
}

interface LoopSessionSnapshot {
  status: string
  summary: string
  mr?: LoopMrSnapshot
}

async function loadLatestLoopActivity(loopEventsPath: string | undefined): Promise<LoopActivitySnapshot | null> {
  if (!loopEventsPath) {
    return null
  }

  const raw = await readFile(loopEventsPath, 'utf-8').catch(() => '')
  if (!raw) {
    return null
  }

  const lines = raw.trim().split('\n').reverse()
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    try {
      const event = JSON.parse(line) as {
        ts?: string
        event?: string
        stage?: string
        cycle?: number
        summary?: string
        provider?: string
        progressType?: string
      }
      if (!event.ts || !event.event) {
        continue
      }
      const displayEvent = {
        ts: event.ts,
        event: event.event,
        ...(event.stage ? { stage: event.stage } : {}),
        ...(Number.isFinite(event.cycle) ? { cycle: event.cycle } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.progressType ? { progressType: event.progressType } : {}),
      }
      return {
        timestamp: event.ts,
        line: formatHarnessEventLine(displayEvent),
        stage: event.stage,
      }
    } catch {
      continue
    }
  }

  return null
}

async function loadLoopMrSnapshot(mrResultPath: string | undefined): Promise<LoopMrSnapshot | null> {
  if (!mrResultPath) {
    return null
  }

  try {
    const raw = await readFile(mrResultPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      status?: string
      url?: string
      reason?: string
      needsHuman?: boolean
    }

    if (parsed.status === 'created' && parsed.url) {
      return { line: `created ${parsed.url}` }
    }

    if (parsed.needsHuman) {
      return { line: `needs manual follow-up${parsed.reason ? ` (${parsed.reason})` : ''}` }
    }
  } catch {
    return null
  }

  return null
}

async function loadLoopSessionSnapshot(loopSessionId: string | undefined): Promise<LoopSessionSnapshot | null> {
  if (!loopSessionId) {
    return null
  }

  const session = await loadWorkflowSession(process.cwd(), 'loop', loopSessionId)
  if (!session) {
    return null
  }

  const mr = await loadLoopMrSnapshot((session.artifacts as { mrResultPath?: string }).mrResultPath)

  return {
    status: session.status,
    summary: session.summary,
    ...(mr ? { mr } : {}),
  }
}

async function loadHarnessRoundSummary(
  roleRoundsDir: string | undefined,
  cycle?: number
): Promise<{ cycle: number; summary: HarnessRoundSummary } | null> {
  if (!roleRoundsDir) {
    if (cycle !== undefined) {
      throw new MissingHarnessCycleError(cycle)
    }
    return null
  }

  try {
    const roundFiles = (await readdir(roleRoundsDir))
      .filter((entry) => /^cycle-\d+\.json$/.test(entry))
      .sort((left, right) => {
        const leftCycle = Number.parseInt(left.match(/\d+/)?.[0] || '0', 10)
        const rightCycle = Number.parseInt(right.match(/\d+/)?.[0] || '0', 10)
        return rightCycle - leftCycle
      })
    const targetFile = cycle
      ? roundFiles.find((entry) => entry === `cycle-${cycle}.json`)
      : roundFiles[0]
    if (!targetFile) {
      if (cycle !== undefined) {
        throw new MissingHarnessCycleError(cycle)
      }
      return null
    }
    return {
      cycle: Number.parseInt(targetFile.match(/\d+/)?.[0] || '0', 10),
      summary: JSON.parse(await readFile(`${roleRoundsDir}/${targetFile}`, 'utf-8')) as HarnessRoundSummary,
    }
  } catch (error) {
    if (error instanceof MissingHarnessCycleError) {
      throw error
    }
    return null
  }
}

async function loadHarnessRoundIndex(roleRoundsDir: string | undefined): Promise<HarnessRoundIndexEntry[]> {
  if (!roleRoundsDir) {
    return []
  }

  try {
    const roundFiles = (await readdir(roleRoundsDir))
      .filter((entry) => /^cycle-\d+\.json$/.test(entry))
      .sort((left, right) => {
        const leftCycle = Number.parseInt(left.match(/\d+/)?.[0] || '0', 10)
        const rightCycle = Number.parseInt(right.match(/\d+/)?.[0] || '0', 10)
        return leftCycle - rightCycle
      })

    const rounds = await Promise.all(roundFiles.map(async (roundFile) => {
      try {
        const cycle = Number.parseInt(roundFile.match(/\d+/)?.[0] || '0', 10)
        const summary = JSON.parse(await readFile(`${roleRoundsDir}/${roundFile}`, 'utf-8')) as HarnessRoundSummary
        return {
          cycle,
          finalAction: summary.finalAction || 'unknown',
        }
      } catch {
        return null
      }
    }))

    return rounds.filter((round): round is HarnessRoundIndexEntry => round !== null)
  } catch {
    return []
  }
}

async function loadHarnessGraph(session: WorkflowSession): Promise<HarnessGraphArtifact | null> {
  return loadHarnessGraphArtifact(process.cwd(), session.id)
}

function formatHarnessGraphRollup(artifact: HarnessGraphArtifact): string {
  return [
    `total=${artifact.rollup.total}`,
    `ready=${artifact.rollup.ready}`,
    `running=${artifact.rollup.running}`,
    `waiting_approval=${artifact.rollup.waitingApproval}`,
    `blocked=${artifact.rollup.blocked}`,
    `completed=${artifact.rollup.completed}`,
    `failed=${artifact.rollup.failed}`,
  ].join(' ')
}

function findHarnessGraphNode(artifact: HarnessGraphArtifact, nodeId: string): HarnessGraphNode {
  const node = artifact.nodes.find((entry) => entry.id === nodeId)
  if (!node) {
    throw new MissingHarnessGraphNodeError(nodeId)
  }
  return node
}

function formatHarnessGraphGate(gate: HarnessGraphApprovalGate): string {
  const decidedBy = gate.decidedBy ? ` by ${gate.decidedBy}` : ''
  return `${gate.gateId}=${gate.status}(${gate.scope}${decidedBy})`
}

function printHarnessGraphSummary(artifact: HarnessGraphArtifact): void {
  console.log(`Graph: ${artifact.graphId} | ${artifact.status} | ${formatHarnessGraphRollup(artifact)}`)
  if (artifact.sourceRequirementPath) {
    console.log(`Graph requirement: ${artifact.sourceRequirementPath}`)
  }
  if (artifact.approvalGates.length > 0) {
    console.log(`Graph approvals: ${artifact.approvalGates.map(formatHarnessGraphGate).join(', ')}`)
  }

  const readyNodes = artifact.nodes.filter((node) => node.state === 'ready').map((node) => node.id)
  if (readyNodes.length > 0) {
    console.log(`Graph ready: ${readyNodes.join(', ')}`)
  }

  const waitingApprovalNodes = artifact.nodes
    .filter((node) => node.state === 'waiting_approval')
    .map((node) => node.id)
  if (waitingApprovalNodes.length > 0) {
    console.log(`Graph waiting approval: ${waitingApprovalNodes.join(', ')}`)
  }

  const blockedNodes = artifact.nodes.filter((node) => node.state === 'blocked').map((node) => node.id)
  if (blockedNodes.length > 0) {
    console.log(`Graph blocked: ${blockedNodes.join(', ')}`)
  }
}

function printHarnessGraphNode(node: HarnessGraphNode): void {
  console.log(`Node: ${node.id} | ${node.state} | ${node.title}`)
  console.log(`Node goal: ${node.goal}`)
  console.log(`Node dependencies: ${node.dependencies.length > 0 ? node.dependencies.join(', ') : '-'}`)
  if (node.stageDocumentPath) {
    console.log(`Node document: ${node.stageDocumentPath}`)
  }
  if (node.conflictScope) {
    console.log(`Node conflict scope: ${node.conflictScope}`)
  }
  if (node.riskMarkers.length > 0) {
    console.log(`Node risks: ${node.riskMarkers.join(', ')}`)
  }
  if (node.approvalGates.length > 0) {
    console.log(`Node approvals: ${node.approvalGates.map(formatHarnessGraphGate).join(', ')}`)
  }
  if (node.statusReason) {
    console.log(`Node reason: ${node.statusReason}`)
  }
}

async function requireHarnessGraph(session: WorkflowSession): Promise<HarnessGraphArtifact> {
  const graph = await loadHarnessGraph(session)
  if (!graph) {
    throw new MissingHarnessGraphError(session.id)
  }
  return graph
}

function approvalSummary(decision: 'approved' | 'rejected', nodeId?: string): string {
  const verb = decision === 'approved' ? 'Approved' : 'Rejected'
  return nodeId
    ? `${verb} graph node gate for ${nodeId}.`
    : `${verb} graph gate.`
}

async function recordHarnessApprovalDecision(
  sessionId: string,
  decision: 'approved' | 'rejected',
  options: HarnessApprovalCommandOptions
): Promise<void> {
  const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
  if (!session) {
    console.error(`Harness session not found: ${sessionId}`)
    process.exitCode = 1
    return
  }

  try {
    const graph = await requireHarnessGraph(session)
    const updatedGraph = recordHarnessGraphApprovalDecision(graph, {
      nodeId: options.node,
      gateId: options.gate,
      decision,
      decidedBy: options.by,
      note: options.note,
    })
    await persistHarnessGraphArtifact(process.cwd(), session.id, updatedGraph)

    const summary = approvalSummary(decision, options.node)
    await persistWorkflowSession(process.cwd(), {
      ...session,
      updatedAt: new Date(),
      summary,
    })
    await appendWorkflowEvent(process.cwd(), 'harness', session.id, {
      timestamp: new Date(),
      type: 'graph_approval_recorded',
      stage: session.currentStage,
      summary,
      details: {
        graphId: updatedGraph.graphId,
        decision,
        ...(options.node ? { nodeId: options.node } : {}),
        ...(options.gate ? { gateId: options.gate } : {}),
        ...(options.by ? { decidedBy: options.by } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    })

    console.log(`Decision: ${decision}`)
    console.log(`Target: ${options.node ? `node ${options.node}` : 'graph'}`)
    printHarnessGraphSummary(updatedGraph)
    if (options.node) {
      printHarnessGraphNode(findHarnessGraphNode(updatedGraph, options.node))
    }
  } catch (error) {
    if (error instanceof MissingHarnessGraphError || error instanceof MissingHarnessGraphNodeError || error instanceof Error) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }
}

async function printHarnessRoundIndex(roleRoundsDir: string | undefined): Promise<void> {
  const rounds = await loadHarnessRoundIndex(roleRoundsDir)
  if (rounds.length === 0) {
    return
  }

  console.log(`Rounds: ${rounds.map((round) => `${round.cycle}=${round.finalAction}`).join(', ')}`)
}

async function printHarnessRoundSummary(roleRoundsDir: string | undefined, cycle?: number): Promise<void> {
  const round = await loadHarnessRoundSummary(roleRoundsDir, cycle)
  if (!round) {
    return
  }

  const label = cycle ? `Round ${round.cycle}` : 'Latest round'
  console.log(`${label}: ${round.summary.finalAction || 'unknown'} | next: ${round.summary.nextRoundBrief || 'No next-round brief.'}`)
}

function describeRoleParticipant(role: NonNullable<HarnessRoundSummary['roles']>[number]): string {
  const id = role.binding?.agent || role.binding?.model || role.binding?.tool || role.displayName || role.roleId
  return `${role.roleId}=${id}`
}

async function printHarnessRoleDetails(roleRoundsDir: string | undefined, cycle?: number): Promise<void> {
  const round = await loadHarnessRoundSummary(roleRoundsDir, cycle)
  if (!round) {
    return
  }

  if (Array.isArray(round.summary.roles) && round.summary.roles.length > 0) {
    console.log(`Participants: ${round.summary.roles.map(describeRoleParticipant).join(', ')}`)
  }

  if (Array.isArray(round.summary.reviewResults) && round.summary.reviewResults.length > 0) {
    console.log(`Review notes: ${round.summary.reviewResults.map((result) => `${result.reviewerRoleId}: ${result.summary}`).join(' | ')}`)
  }

  if (round.summary.arbitrationResult?.summary) {
    console.log(`Decision note: ${round.summary.arbitrationResult.summary}`)
  }
}

async function runHarness(input: HarnessInput, options: HarnessCommandOptions): Promise<void> {
  return runHarnessWithSession(input, options)
}

async function findRecoverableHarnessSession(
  goal: string,
  prdPath: string
): Promise<WorkflowSession | null> {
  const sessions = (await listWorkflowSessions(process.cwd(), 'harness'))
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  for (const session of sessions) {
    const persisted = extractHarnessResumeInput(session)
    if (!persisted) {
      continue
    }
    if (persisted.input.goal !== goal
      || normalizeComparablePrdPath(persisted.input.prdPath) !== normalizeComparablePrdPath(prdPath)) {
      continue
    }

    const loopSession = session.artifacts.loopSessionId
      ? await loadWorkflowSession(process.cwd(), 'loop', session.artifacts.loopSessionId)
      : null
    if (!canResumeFailedDevelopmentSession(session, loopSession)) {
      continue
    }

    return session
  }

  return null
}

async function runHarnessWithSession(
  input: HarnessInput,
  options: HarnessCommandOptions,
  sessionId?: string
): Promise<void> {
  const registry = createDefaultCapabilityRegistry()
  const capability = getTypedCapability<HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary>(
    registry,
    'harness'
  )
  const progressReporter = createHarnessProgressReporter()
  const ctx = createCapabilityContext({
    cwd: process.cwd(),
    configPath: options.config,
    metadata: {
      harnessProgress: progressReporter,
    },
  })
  progressReporter.start()
  const previousSessionId = process.env.MAGPIE_SESSION_ID
  if (sessionId) {
    process.env.MAGPIE_SESSION_ID = sessionId
  }
  const { output, result } = await (async () => {
    try {
      return await runCapability(capability, input, ctx)
    } finally {
      progressReporter.stop()
      if (sessionId) {
        if (previousSessionId === undefined) {
          delete process.env.MAGPIE_SESSION_ID
        } else {
          process.env.MAGPIE_SESSION_ID = previousSessionId
        }
      }
    }
  })()

  console.log(output.summary)
  if (output.details) {
    if (!progressReporter.hasAnnouncedSession()) {
      console.log(`Session: ${output.details.id}`)
      console.log(`Status: ${output.details.status}`)
      if (output.details.currentStage) {
        console.log(`Stage: ${output.details.currentStage}`)
      }
      if (output.details.artifacts.eventsPath) {
        console.log(`Events: ${output.details.artifacts.eventsPath}`)
      }
    }
    if (output.details.artifacts.workspacePath) {
      console.log(`Workspace: ${output.details.artifacts.workspacePath} (${output.details.artifacts.workspaceMode || 'current'})`)
    }
    if (output.details.artifacts.executionHost) {
      console.log(`Host: ${output.details.artifacts.executionHost}`)
    }
    if (output.details.artifacts.tmuxSession || output.details.artifacts.tmuxWindow || output.details.artifacts.tmuxPane) {
      console.log(`Tmux: session=${output.details.artifacts.tmuxSession || '-'} window=${output.details.artifacts.tmuxWindow || '-'} pane=${output.details.artifacts.tmuxPane || '-'}`)
    }
    console.log(`Config: ${output.details.artifacts.harnessConfigPath}`)
    console.log(`Rounds: ${output.details.artifacts.roundsPath}`)
    console.log(`Provider selection: ${output.details.artifacts.providerSelectionPath}`)
    console.log(`Routing: ${output.details.artifacts.routingDecisionPath}`)
    if (output.details.artifacts.loopSessionId) {
      console.log(`Loop session: ${output.details.artifacts.loopSessionId}`)
      const loopSnapshot = await loadLoopSessionSnapshot(output.details.artifacts.loopSessionId)
      if (loopSnapshot) {
        console.log(`Loop status: ${loopSnapshot.status}`)
        console.log(`Loop summary: ${loopSnapshot.summary}`)
        if (loopSnapshot.mr) {
          console.log(`Loop MR: ${loopSnapshot.mr.line}`)
        }
      }
    }
  }

  if (result.status === 'failed') {
    process.exitCode = 1
  }
}

function extractHarnessResumeInput(session: WorkflowSession): {
  input: HarnessInput
  configPath?: string
} | null {
  const evidence = session.evidence as PersistedHarnessResumeEvidence | undefined
  if (!evidence?.input?.goal || !evidence.input.prdPath) {
    return null
  }

  return {
    input: evidence.input,
    ...(evidence.configPath ? { configPath: evidence.configPath } : {}),
  }
}

function canResumeFailedDevelopmentSession(
  session: WorkflowSession,
  loopSession: WorkflowSession | null
): boolean {
  if (isRecoverableHarnessSession(session, loopSession || undefined)) {
    return true
  }

  // Older harness sessions can stay marked as failed even when the linked loop
  // already persisted a trustworthy rerun checkpoint in a later inner stage.
  if (session.status === 'failed' && isRecoverableLoopSession(loopSession || undefined)) {
    return true
  }

  const evidence = session.evidence as PersistedHarnessResumeEvidence | undefined
  if (session.status !== 'failed' || evidence?.runtime?.lastReliablePoint !== 'developing') {
    return false
  }

  // Some older failed harness sessions persisted the terminal stage after the
  // loop had already left a trustworthy development checkpoint.
  return isRecoverableHarnessSession({
    ...session,
    currentStage: 'developing',
  }, loopSession || undefined)
}

export const harnessCommand = new Command('harness')
  .description('Run and inspect harness workflow sessions')

harnessCommand
  .command('submit')
  .description('Start a harness workflow run')
  .argument('<goal>', 'Requirement goal')
  .requiredOption('--prd <path>', 'PRD markdown path')
  .option('-c, --config <path>', 'Path to config file')
  .option('--max-cycles <number>', 'Maximum fix/review/test cycles', (v) => Number.parseInt(v, 10))
  .option('--review-rounds <number>', 'Review debate rounds per cycle', (v) => Number.parseInt(v, 10))
  .option('--test-command <command>', 'Override unit test command used by harness')
  .option('--models <models...>', 'Model list for adversarial confirmation (overrides config defaults)')
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .option('--host <host>', 'Execution host (foreground|tmux)')
  .option('--priority <level>', 'Queue priority (interactive|high|normal|background)', parseHarnessPriority)
  .action(async (goal: string, options: HarnessCommandOptions & { prd: string }) => {
    try {
      const queuedInput: HarnessInput = {
        goal,
        prdPath: options.prd,
        maxCycles: Number.isFinite(options.maxCycles) ? options.maxCycles : undefined,
        reviewRounds: Number.isFinite(options.reviewRounds) ? options.reviewRounds : undefined,
        testCommand: options.testCommand,
        models: Array.isArray(options.models) && options.models.length > 0 ? options.models : undefined,
        complexity: options.complexity,
        host: options.host,
        priority: options.priority,
      }
      const recoverableSession = await findRecoverableHarnessSession(goal, options.prd)

      if (await isHarnessServerRunning(process.cwd())) {
        if (recoverableSession) {
          const persisted = extractHarnessResumeInput(recoverableSession)
          const mergedInput = mergeHarnessResumeInput(persisted?.input, queuedInput)
          await persistWorkflowSession(process.cwd(), {
            ...recoverableSession,
            updatedAt: new Date(),
            status: 'waiting_next_cycle',
            currentStage: recoverableSession.currentStage || 'developing',
            summary: 'Recoverable harness session re-queued for resume.',
            evidence: {
              ...(recoverableSession.evidence as Record<string, unknown> || {}),
              input: mergedInput,
              ...((options.config || persisted?.configPath)
                ? { configPath: options.config || persisted?.configPath }
                : {}),
            },
          })
          await appendWorkflowEvent(process.cwd(), 'harness', recoverableSession.id, {
            timestamp: new Date(),
            type: 'workflow_requeued',
            stage: recoverableSession.currentStage || 'developing',
            summary: 'Recoverable harness session selected by submit and queued to resume.',
          })
          console.log(`Resuming recoverable harness session: ${recoverableSession.id}`)
          console.log(`Session: ${recoverableSession.id}`)
          console.log('Status: waiting_next_cycle')
          return
        }
        const queued = await enqueueHarnessSession(process.cwd(), queuedInput, {
          configPath: options.config,
          graph: buildQueuedHarnessGraph(goal, options.prd),
        })
        console.log('Harness session queued.')
        console.log(`Session: ${queued.id}`)
        console.log(`Status: ${queued.status}`)
        console.log(`Priority: ${queuedInput.priority || 'normal'}`)
        if (queued.artifacts.eventsPath) {
          console.log(`Events: ${queued.artifacts.eventsPath}`)
        }
        return
      }

      if (recoverableSession) {
        const persisted = extractHarnessResumeInput(recoverableSession)
        console.log(`Resuming recoverable harness session: ${recoverableSession.id}`)
        await runHarnessWithSession(
          mergeHarnessResumeInput(persisted?.input, queuedInput),
          {
            ...options,
            config: options.config || persisted?.configPath,
          },
          recoverableSession.id
        )
        return
      }

      if (options.host === 'tmux' && !process.env.VITEST) {
        const launch = await launchMagpieInTmux({
          capability: 'harness',
          cwd: process.cwd(),
          configPath: options.config,
          argv: [
            'harness',
            'submit',
            goal,
            '--prd',
            options.prd,
            '--host',
            'foreground',
            ...(options.config ? ['--config', options.config] : []),
            ...(Number.isFinite(options.maxCycles) ? ['--max-cycles', String(options.maxCycles)] : []),
            ...(Number.isFinite(options.reviewRounds) ? ['--review-rounds', String(options.reviewRounds)] : []),
            ...(options.testCommand ? ['--test-command', options.testCommand] : []),
            ...(Array.isArray(options.models) && options.models.length > 0 ? ['--models', ...options.models] : []),
            ...(options.complexity ? ['--complexity', options.complexity] : []),
          ],
        })

        console.log(`Session: ${launch.sessionId}`)
        console.log('Host: tmux')
        console.log(`Tmux: session=${launch.tmuxSession} window=${launch.tmuxWindow || '-'} pane=${launch.tmuxPane || '-'}`)
        return
      }

      await runHarness(queuedInput, options)
    } catch (error) {
      console.error(`harness failed: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  })

harnessCommand
  .command('status')
  .description('Show details for a persisted harness session')
  .argument('<sessionId>', 'Harness session ID')
  .option('--cycle <number>', 'Show a specific persisted review cycle', parseHarnessCycle)
  .option('--node <id>', 'Show a specific graph node when the session has a graph')
  .action(async (sessionId: string, options: HarnessRoundViewOptions) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (session.currentStage) {
      console.log(`Stage: ${session.currentStage}`)
    }
    if (session.artifacts.workspacePath) {
      console.log(`Workspace: ${session.artifacts.workspacePath} (${session.artifacts.workspaceMode || 'current'})`)
    }
    if (session.artifacts.executionHost) {
      console.log(`Host: ${session.artifacts.executionHost}`)
    }
    if (session.artifacts.tmuxSession || session.artifacts.tmuxWindow || session.artifacts.tmuxPane) {
      console.log(`Tmux: session=${session.artifacts.tmuxSession || '-'} window=${session.artifacts.tmuxWindow || '-'} pane=${session.artifacts.tmuxPane || '-'}`)
    }
    const graph = await loadHarnessGraph(session)
    if (graph) {
      printHarnessGraphSummary(graph)
      if (options.node) {
        try {
          printHarnessGraphNode(findHarnessGraphNode(graph, options.node))
        } catch (error) {
          if (error instanceof MissingHarnessGraphNodeError) {
            console.error(error.message)
            process.exitCode = 1
            return
          }
          throw error
        }
      }
    }
    await printHarnessRoundIndex(session.artifacts.roleRoundsDir)
    try {
      await printHarnessRoundSummary(session.artifacts.roleRoundsDir, options.cycle)
      await printHarnessRoleDetails(session.artifacts.roleRoundsDir, options.cycle)
    } catch (error) {
      if (error instanceof MissingHarnessCycleError) {
        console.error(error.message)
        process.exitCode = 1
        return
      }
      throw error
    }
    console.log(`Summary: ${session.summary}`)
    console.log(`Updated: ${formatLocalDateTime(session.updatedAt)}`)
    if (session.artifacts.eventsPath) {
      console.log(`Events: ${session.artifacts.eventsPath}`)
    }
    await printDocumentPlanSummary(session.artifacts.documentPlanPath)
    const loopSnapshot = await loadLoopSessionSnapshot(session.artifacts.loopSessionId)
    if (loopSnapshot) {
      console.log(`Loop status: ${loopSnapshot.status}`)
      console.log(`Loop summary: ${loopSnapshot.summary}`)
      if (loopSnapshot.mr) {
        console.log(`Loop MR: ${loopSnapshot.mr.line}`)
      }
    }
    const latestLoopActivity = await loadLatestLoopActivity(session.artifacts.loopEventsPath)
    if (latestLoopActivity) {
      if (latestLoopActivity.stage) {
        console.log(`Loop stage: ${latestLoopActivity.stage}`)
      }
      console.log(`Last activity: ${formatLocalDateTime(latestLoopActivity.timestamp)}`)
      console.log(`Loop activity: ${latestLoopActivity.line}`)
    }
    await printKnowledgeSummary(session.artifacts)
  })

harnessCommand
  .command('resume')
  .description('Resume a persisted harness session')
  .argument('<sessionId>', 'Harness session ID')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (sessionId: string, options: Pick<HarnessCommandOptions, 'config'>) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    const persisted = extractHarnessResumeInput(session)
    if (!persisted) {
      console.error(`Harness session ${sessionId} cannot be resumed because its input metadata is missing.`)
      process.exitCode = 1
      return
    }

    if (session.status === 'failed') {
      const loopSession = session.artifacts.loopSessionId
        ? await loadWorkflowSession(process.cwd(), 'loop', session.artifacts.loopSessionId)
        : null
      if (!canResumeFailedDevelopmentSession(session, loopSession)) {
        console.error(
          `Harness session ${sessionId} cannot be resumed because its linked recovery checkpoint is not recoverable.`
        )
        process.exitCode = 1
        return
      }
    }

    await runHarnessWithSession(
      persisted.input,
      { config: options.config || persisted.configPath },
      session.id
    )
  })

harnessCommand
  .command('confirm')
  .description('Approve or reject the latest pending loop confirmation linked to a harness session')
  .argument('<sessionId>', 'Harness session ID')
  .option('-c, --config <path>', 'Path to config file')
  .option('--approve', 'Approve the pending confirmation and continue automatically')
  .option('--reject', 'Reject the pending confirmation and trigger auto discussion')
  .option('--reason <text>', 'Reason for rejection')
  .action(async (sessionId: string, options: HarnessConfirmCommandOptions) => {
    try {
      const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
      if (!session) {
        console.error(`Harness session not found: ${sessionId}`)
        process.exitCode = 1
        return
      }

      if (!session.artifacts.loopSessionId) {
        console.error(`Harness session ${sessionId} has no linked loop session.`)
        process.exitCode = 1
        return
      }

      const loopStateManager = new StateManager(process.cwd())
      await loopStateManager.initLoopSessions()
      const loopSession = await loopStateManager.loadLoopSession(session.artifacts.loopSessionId)
      if (!loopSession) {
        console.error(`Linked loop session not found: ${session.artifacts.loopSessionId}`)
        process.exitCode = 1
        return
      }

      await applyLoopConfirmationDecision(process.cwd(), loopSession, {
        ...options,
        config: options.config,
      })

      if (options.approve) {
        const persisted = extractHarnessResumeInput(session)
        if (!persisted) {
          console.error(`Harness session ${sessionId} cannot be resumed because its input metadata is missing.`)
          process.exitCode = 1
          return
        }
        await runHarnessWithSession(
          persisted.input,
          { config: options.config || persisted.configPath },
          session.id
        )
        return
      }

      console.log(`Rejected pending human confirmation for ${session.id}.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  })

harnessCommand
  .command('attach')
  .description('Print the persisted harness event stream for a session')
  .argument('<sessionId>', 'Harness session ID')
  .option('--once', 'Print current events and exit')
  .action(async (sessionId: string, options: { once?: boolean }) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    await printHarnessRoundIndex(session.artifacts.roleRoundsDir)
    await printHarnessRoundSummary(session.artifacts.roleRoundsDir)
    if (session.artifacts.workspacePath) {
      console.log(`Workspace: ${session.artifacts.workspacePath} (${session.artifacts.workspaceMode || 'current'})`)
    }
    if (session.artifacts.executionHost) {
      console.log(`Host: ${session.artifacts.executionHost}`)
    }
    if (session.artifacts.tmuxSession || session.artifacts.tmuxWindow || session.artifacts.tmuxPane) {
      console.log(`Tmux: session=${session.artifacts.tmuxSession || '-'} window=${session.artifacts.tmuxWindow || '-'} pane=${session.artifacts.tmuxPane || '-'}`)
    }
    await printKnowledgeSummary(session.artifacts)
    await followHarnessEventStream({
      sessionId,
      initialSession: session,
      loadSession: async (id) => loadWorkflowSession(process.cwd(), 'harness', id),
      once: !!options.once,
    })
  })

harnessCommand
  .command('inspect')
  .description('Show the knowledge summary for a harness session')
  .argument('<sessionId>', 'Harness session ID')
  .option('--cycle <number>', 'Show a specific persisted review cycle', parseHarnessCycle)
  .option('--node <id>', 'Show a specific graph node when the session has a graph')
  .action(async (sessionId: string, options: HarnessRoundViewOptions) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    await printDocumentPlanSummary(session.artifacts.documentPlanPath)
    await printKnowledgeInspectView(session.artifacts, legacyHarnessKnowledgeState(session))
    const graph = await loadHarnessGraph(session)
    if (graph) {
      printHarnessGraphSummary(graph)
      if (options.node) {
        try {
          printHarnessGraphNode(findHarnessGraphNode(graph, options.node))
        } catch (error) {
          if (error instanceof MissingHarnessGraphNodeError) {
            console.error(error.message)
            process.exitCode = 1
            return
          }
          throw error
        }
      }
    }
    await printHarnessRoundIndex(session.artifacts.roleRoundsDir)
    try {
      await printHarnessRoundSummary(session.artifacts.roleRoundsDir, options.cycle)
      await printHarnessRoleDetails(session.artifacts.roleRoundsDir, options.cycle)
    } catch (error) {
      if (error instanceof MissingHarnessCycleError) {
        console.error(error.message)
        process.exitCode = 1
        return
      }
      throw error
    }
  })

harnessCommand
  .command('approve')
  .description('Approve a waiting graph or graph node gate')
  .argument('<sessionId>', 'Harness session ID')
  .option('--node <id>', 'Approve a specific graph node gate')
  .option('--gate <id>', 'Approve a specific gate when multiple are present')
  .option('--by <name>', 'Record who made the decision')
  .option('--note <text>', 'Attach a short note to the decision')
  .action(async (sessionId: string, options: HarnessApprovalCommandOptions) => {
    await recordHarnessApprovalDecision(sessionId, 'approved', options)
  })

harnessCommand
  .command('reject')
  .description('Reject a waiting graph or graph node gate')
  .argument('<sessionId>', 'Harness session ID')
  .option('--node <id>', 'Reject a specific graph node gate')
  .option('--gate <id>', 'Reject a specific gate when multiple are present')
  .option('--by <name>', 'Record who made the decision')
  .option('--note <text>', 'Attach a short note to the decision')
  .action(async (sessionId: string, options: HarnessApprovalCommandOptions) => {
    await recordHarnessApprovalDecision(sessionId, 'rejected', options)
  })

harnessCommand
  .command('list')
  .description('List persisted harness sessions')
  .action(async () => {
    const sessions = await listWorkflowSessions(process.cwd(), 'harness')
    if (sessions.length === 0) {
      console.log('No harness sessions found.')
      return
    }

    for (const session of sessions) {
      const graph = await loadHarnessGraph(session)
      const parts = [
        session.id,
        session.status,
        session.currentStage || '-',
        formatLocalDateTime(session.updatedAt),
        session.title,
      ]
      if (graph) {
        parts.push(`graph=${graph.graphId}:${graph.status}:ready=${graph.rollup.ready}:running=${graph.rollup.running}:waiting_approval=${graph.rollup.waitingApproval}:blocked=${graph.rollup.blocked}`)
      }
      console.log(parts.join('\t'))
    }
  })

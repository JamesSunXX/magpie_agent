import { readFile } from 'fs/promises'
import { join } from 'path'
import { loadWorkflowSession, type WorkflowSession } from '../capabilities/workflows/shared/runtime.js'
import type { HarnessGraphArtifact, HarnessGraphNode } from '../capabilities/workflows/harness-server/graph.js'
import { getRepoSessionDir } from '../platform/paths.js'
import type {
  GraphWorkbenchAction,
  GraphWorkbenchData,
  GraphWorkbenchEventItem,
  GraphWorkbenchLinkedExecution,
  GraphWorkbenchNodeDetail,
} from './types.js'

interface LoadGraphWorkbenchOptions {
  cwd: string
  sessionId: string
  selectedNodeId?: string
}

interface LoopSessionFile {
  id: string
  status: 'running' | 'paused_for_human' | 'completed' | 'failed'
  stageResults?: Array<{
    summary?: string
  }>
  artifacts?: {
    knowledgeStatePath?: string
  }
}

interface KnowledgeStateFile {
  lastReliableResult?: string
  nextAction?: string
}

interface PersistedWorkflowEvent {
  timestamp?: string
  type?: string
  stage?: string
  cycle?: number
  summary?: string
  details?: Record<string, unknown>
}

interface HarnessRoleRoundSummary {
  reviewResults?: Array<{
    reviewerRoleId?: string
    summary?: string
  }>
  arbitrationResult?: {
    summary?: string
  }
  openIssues?: Array<{
    title?: string
    severity?: 'critical' | 'high' | 'medium' | 'low'
    sourceRole?: string
  }>
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function loadLatestHarnessRoleRoundSummary(roleRoundsDir: string | undefined): Promise<HarnessRoleRoundSummary | null> {
  if (!roleRoundsDir) {
    return null
  }

  try {
    const { readdir } = await import('fs/promises')
    const entries = (await readdir(roleRoundsDir))
      .filter((entry) => /^cycle-\d+\.json$/.test(entry))
      .sort((left, right) => {
        const leftCycle = Number.parseInt(left.match(/\d+/)?.[0] || '0', 10)
        const rightCycle = Number.parseInt(right.match(/\d+/)?.[0] || '0', 10)
        return rightCycle - leftCycle
      })
    const latest = entries[0]
    return latest ? await readJsonFile<HarnessRoleRoundSummary>(join(roleRoundsDir, latest)) : null
  } catch {
    return null
  }
}

function getDefaultSelectedNodeId(graph: HarnessGraphArtifact): string | undefined {
  return graph.nodes.find((node) => node.state === 'waiting_approval')?.id
    || graph.nodes.find((node) => node.state === 'blocked')?.id
    || graph.nodes[0]?.id
}

function buildAttention(graph: HarnessGraphArtifact): string[] {
  const waitingApprovalItems: string[] = []
  const blockedItems: string[] = []
  const retryItems: string[] = []

  for (const node of graph.nodes) {
    if (node.state === 'waiting_approval' && node.statusReason) {
      waitingApprovalItems.push(`Waiting approval: ${node.id} - ${node.statusReason}`)
    }
    if (node.state === 'blocked' && node.statusReason) {
      blockedItems.push(`Blocked: ${node.id} - ${node.statusReason}`)
    }
    if (node.state === 'waiting_retry' && node.statusReason) {
      retryItems.push(`Retrying soon: ${node.id} - ${node.statusReason}`)
    }
  }

  return [...waitingApprovalItems, ...blockedItems, ...retryItems]
}

function buildLoopCommand(session: LoopSessionFile): string[] {
  return session.status === 'paused_for_human'
    ? ['loop', 'resume', session.id]
    : ['loop', 'inspect', session.id]
}

function buildHarnessCommand(session: WorkflowSession): string[] {
  if (session.status === 'in_progress') {
    return ['harness', 'attach', session.id, '--once']
  }

  if (session.status === 'blocked') {
    return ['harness', 'resume', session.id]
  }

  return ['harness', 'inspect', session.id]
}

async function loadLinkedExecution(
  cwd: string,
  node: HarnessGraphNode
): Promise<GraphWorkbenchLinkedExecution | undefined> {
  if (!node.execution) {
    return undefined
  }

  if (node.execution.capability === 'loop') {
    const loopSession = await readJsonFile<LoopSessionFile>(join(
      getRepoSessionDir(cwd, 'loop', node.execution.sessionId),
      'session.json'
    ))

    if (!loopSession) {
      return undefined
    }

    const knowledgeState = await readJsonFile<KnowledgeStateFile>(loopSession.artifacts?.knowledgeStatePath || '')
    const summary = knowledgeState?.lastReliableResult
      || loopSession.stageResults?.at(-1)?.summary
      || 'No session summary yet.'

    return {
      capability: 'loop',
      sessionId: loopSession.id,
      status: loopSession.status,
      summary,
      ...(knowledgeState?.nextAction ? { nextStep: knowledgeState.nextAction } : {}),
      command: buildLoopCommand(loopSession),
    }
  }

  const harnessSession = await loadWorkflowSession(cwd, 'harness', node.execution.sessionId)
  if (!harnessSession) {
    return undefined
  }

  const knowledgeState = await readJsonFile<KnowledgeStateFile>(harnessSession.artifacts.knowledgeStatePath || '')

  return {
    capability: 'harness',
    sessionId: harnessSession.id,
    status: harnessSession.status,
    summary: knowledgeState?.lastReliableResult || harnessSession.summary || 'No session summary yet.',
    ...(knowledgeState?.nextAction ? { nextStep: knowledgeState.nextAction } : {}),
    command: buildHarnessCommand(harnessSession),
  }
}

async function buildSelectedNodeDetail(
  cwd: string,
  node: HarnessGraphNode | undefined
): Promise<GraphWorkbenchNodeDetail | undefined> {
  if (!node) {
    return undefined
  }

  const linkedExecution = await loadLinkedExecution(cwd, node)
  let unresolvedIssues: string[] = []
  let reviewerSummaries: string[] = []
  let arbitrationSummary: string | undefined

  if (node.execution?.capability === 'harness') {
    const harnessSession = await loadWorkflowSession(cwd, 'harness', node.execution.sessionId)
    const latestRound = await loadLatestHarnessRoleRoundSummary(harnessSession?.artifacts.roleRoundsDir)
    reviewerSummaries = (latestRound?.reviewResults || [])
      .map((item) => item.summary?.trim())
      .filter((summary): summary is string => Boolean(summary))
    arbitrationSummary = latestRound?.arbitrationResult?.summary?.trim() || undefined
    unresolvedIssues = (latestRound?.openIssues || [])
      .filter((issue) => issue.title)
      .map((issue) => `[${issue.severity || 'unknown'}] ${issue.sourceRole || 'reviewer'}: ${issue.title}`.trim())
  }

  return {
    id: node.id,
    title: node.title,
    type: node.type,
    state: node.state,
    ...(node.stageDocumentPath ? { stageDocumentPath: node.stageDocumentPath } : {}),
    ...(node.statusReason ? { statusReason: node.statusReason } : {}),
    dependencies: [...node.dependencies],
    approvalPending: node.approvalGates.some((gate) => gate.status === 'pending'),
    ...(linkedExecution?.summary ? { latestSummary: linkedExecution.summary } : {}),
    ...(linkedExecution?.nextStep ? { nextStep: linkedExecution.nextStep } : {}),
    reviewerSummaries,
    ...(arbitrationSummary ? { arbitrationSummary } : {}),
    unresolvedIssues,
    ...(linkedExecution ? { linkedExecution } : {}),
  }
}

function buildActionLabel(kind: 'approve' | 'reject', label: string): string {
  return kind === 'approve' ? label : label.replace(/^Approve\s+/i, 'Reject ')
}

function buildGraphGateActions(
  sessionId: string,
  graph: HarnessGraphArtifact
): GraphWorkbenchAction[] {
  const actions: GraphWorkbenchAction[] = []

  for (const gate of graph.approvalGates) {
    if (gate.status !== 'pending') {
      continue
    }

    actions.push({
      id: `approve:graph:${gate.gateId}`,
      kind: 'approve',
      label: gate.label,
      description: 'Approve pending graph gate.',
      command: ['harness', 'approve', sessionId, '--gate', gate.gateId],
      requiresConfirmation: false,
    })
    actions.push({
      id: `reject:graph:${gate.gateId}`,
      kind: 'reject',
      label: 'Reject graph',
      description: 'Reject pending graph gate.',
      command: ['harness', 'reject', sessionId, '--gate', gate.gateId],
      requiresConfirmation: true,
    })
  }

  return actions
}

function buildSelectedNodeActions(
  graph: HarnessGraphArtifact,
  sessionId: string,
  selectedNode: HarnessGraphNode | undefined,
  linkedExecution: GraphWorkbenchLinkedExecution | undefined
): GraphWorkbenchAction[] {
  const actions: GraphWorkbenchAction[] = [...buildGraphGateActions(sessionId, graph)]

  for (const gate of selectedNode?.approvalGates || []) {
    if (gate.status !== 'pending') {
      continue
    }

    actions.push({
      id: `approve:node:${selectedNode?.id}:${gate.gateId}`,
      kind: 'approve',
      label: buildActionLabel('approve', gate.label),
      description: `Approve pending gate for ${selectedNode?.id}.`,
      command: ['harness', 'approve', sessionId, '--node', selectedNode?.id || '', '--gate', gate.gateId],
      requiresConfirmation: false,
    })
    actions.push({
      id: `reject:node:${selectedNode?.id}:${gate.gateId}`,
      kind: 'reject',
      label: buildActionLabel('reject', gate.label),
      description: `Reject pending gate for ${selectedNode?.id}.`,
      command: ['harness', 'reject', sessionId, '--node', selectedNode?.id || '', '--gate', gate.gateId],
      requiresConfirmation: true,
    })
  }

  if (linkedExecution) {
    const commandVerb = linkedExecution.command[1] === 'resume'
      ? 'Resume'
      : linkedExecution.command[1] === 'attach'
        ? 'Attach'
        : 'Inspect'
    actions.push({
      id: `jump:${linkedExecution.capability}:${linkedExecution.sessionId}`,
      kind: 'jump',
      label: `Open linked ${linkedExecution.capability} session`,
      description: `${commandVerb} linked ${linkedExecution.capability} session ${linkedExecution.sessionId}.`,
      command: [...linkedExecution.command],
      requiresConfirmation: false,
    })
  }

  return actions
}

function isRelevantEvent(type: string | undefined): boolean {
  return [
    'graph_approval_recorded',
    'workflow_started',
    'workflow_resumed',
    'stage_changed',
    'stage_paused',
    'cycle_completed',
    'workflow_completed',
    'workflow_failed',
    'waiting_retry',
  ].includes(type || '')
}

function summarizeEvent(event: PersistedWorkflowEvent): string | undefined {
  switch (event.type) {
    case 'graph_approval_recorded': {
      const nodeId = typeof event.details?.nodeId === 'string' ? event.details.nodeId : 'graph'
      const decision = typeof event.details?.decision === 'string' ? event.details.decision : 'recorded'
      return `Approval ${decision.replace(/ed$/, '')}ed for ${nodeId}.`
    }
    case 'workflow_started':
      return 'Workflow started.'
    case 'workflow_resumed':
      return 'Workflow resumed.'
    case 'stage_changed':
      return `Stage changed: ${event.stage || 'unknown'}. ${event.summary || ''}`.trim()
    case 'stage_paused':
      return `Stage paused: ${event.stage || 'unknown'}. ${event.summary || ''}`.trim()
    case 'cycle_completed':
      return event.summary
    case 'workflow_completed':
      return event.summary || 'Workflow completed.'
    case 'workflow_failed':
      return event.summary || 'Workflow failed.'
    case 'waiting_retry':
      return event.summary || 'Retry scheduled.'
    default:
      return undefined
  }
}

async function loadRecentEvents(eventsPath: string | undefined): Promise<GraphWorkbenchEventItem[]> {
  if (!eventsPath) {
    return []
  }

  const raw = await readFile(eventsPath, 'utf-8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  const parsed = raw
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      try {
        return { event: JSON.parse(line) as PersistedWorkflowEvent, index }
      } catch {
        return null
      }
    })
    .filter((item): item is { event: PersistedWorkflowEvent; index: number } => item !== null)
    .filter(({ event }) => isRelevantEvent(event.type))
    .map(({ event, index }) => {
      const summary = summarizeEvent(event)
      if (!summary || !event.timestamp) {
        return null
      }
      return {
        id: `${event.timestamp}:${event.type}:${index}`,
        timestamp: event.timestamp,
        summary,
      }
    })
    .filter((item): item is GraphWorkbenchEventItem => item !== null)

  return parsed.reverse().slice(0, 8)
}

export async function loadGraphWorkbench(options: LoadGraphWorkbenchOptions): Promise<GraphWorkbenchData> {
  const session = await loadWorkflowSession(options.cwd, 'harness', options.sessionId)
  if (!session?.artifacts.graphPath) {
    return {
      graph: {
        sessionId: options.sessionId,
        graphId: options.sessionId,
        title: options.sessionId,
        status: 'missing',
        rollup: {
          total: 0,
          ready: 0,
          running: 0,
          waitingApproval: 0,
          waitingRetry: 0,
          blocked: 0,
          completed: 0,
          failed: 0,
        },
      },
      nodes: [],
      actions: [],
      attention: [],
      events: [],
      error: 'Graph artifact is not available for this session.',
    }
  }

  const graph = await readJsonFile<HarnessGraphArtifact>(session.artifacts.graphPath)
  if (!graph) {
    return {
      graph: {
        sessionId: options.sessionId,
        graphId: options.sessionId,
        title: options.sessionId,
        status: 'error',
        rollup: {
          total: 0,
          ready: 0,
          running: 0,
          waitingApproval: 0,
          waitingRetry: 0,
          blocked: 0,
          completed: 0,
          failed: 0,
        },
      },
      nodes: [],
      actions: [],
      attention: [],
      events: await loadRecentEvents(session.artifacts.eventsPath),
      error: 'Graph artifact could not be read.',
    }
  }

  const selectedNodeId = options.selectedNodeId && graph.nodes.some((node) => node.id === options.selectedNodeId)
    ? options.selectedNodeId
    : getDefaultSelectedNodeId(graph)
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  const selectedNodeDetail = await buildSelectedNodeDetail(options.cwd, selectedNode)
  const linkedExecution = selectedNodeDetail?.linkedExecution

  return {
    graph: {
      sessionId: options.sessionId,
      graphId: graph.graphId,
      title: graph.title,
      status: graph.status,
      rollup: {
        total: graph.rollup.total,
        ready: graph.rollup.ready,
        running: graph.rollup.running,
        waitingApproval: graph.rollup.waitingApproval,
        waitingRetry: graph.rollup.waitingRetry,
        blocked: graph.rollup.blocked,
        completed: graph.rollup.completed,
        failed: graph.rollup.failed,
      },
    },
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      state: node.state,
      ...(node.statusReason ? { statusReason: node.statusReason } : {}),
      approvalPending: node.approvalGates.some((gate) => gate.status === 'pending'),
    })),
    ...(selectedNodeId ? { selectedNodeId } : {}),
    ...(selectedNodeDetail ? { selectedNode: selectedNodeDetail } : {}),
    actions: buildSelectedNodeActions(graph, options.sessionId, selectedNode, linkedExecution),
    attention: buildAttention(graph),
    events: await loadRecentEvents(session.artifacts.eventsPath),
  }
}

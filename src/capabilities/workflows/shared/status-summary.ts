import { StateManager } from '../../../state/state-manager.js'
import {
  listWorkflowSessions,
  type WorkflowCapability,
  type WorkflowSession,
} from './runtime.js'
import {
  classifyStatus,
  inspectCommand,
  nextActionForTask,
  type UnifiedTaskKind,
  type UnifiedTaskStatus,
} from '../../../core/status/task-status.js'

export { formatTaskStatus, classifyStatus, inspectCommand, nextActionForTask } from '../../../core/status/task-status.js'

export interface UnifiedStatusSummary {
  tasks: UnifiedTaskStatus[]
  counts: Record<UnifiedTaskKind, number>
}

function emptyCounts(): Record<UnifiedTaskKind, number> {
  return {
    running: 0,
    waiting: 0,
    failed: 0,
    completed: 0,
    queued: 0,
  }
}

function runtimeEvidence(session: WorkflowSession): { nextRetryAt?: string; lastError?: string } {
  const runtime = (session.evidence as { runtime?: { nextRetryAt?: string; lastError?: string } } | undefined)?.runtime
  return {
    ...(runtime?.nextRetryAt ? { nextRetryAt: runtime.nextRetryAt } : {}),
    ...(runtime?.lastError ? { lastError: runtime.lastError } : {}),
  }
}

export function taskStatusFromWorkflowSession(session: WorkflowSession): UnifiedTaskStatus {
  const runtime = runtimeEvidence(session)
  const capability = session.capability === 'loop' ? 'loop' : 'harness'
  const status = session.status
  return {
    capability,
    sessionId: session.id,
    title: session.title,
    status,
    kind: classifyStatus(status),
    ...(session.currentStage ? { stage: session.currentStage } : {}),
    ...(session.summary ? { summary: session.summary } : {}),
    ...(runtime.lastError ? { reason: runtime.lastError } : {}),
    nextAction: nextActionForTask({
      capability,
      sessionId: session.id,
      status,
      ...(runtime.nextRetryAt ? { nextRetryAt: runtime.nextRetryAt } : {}),
    }),
    updatedAt: session.updatedAt.toISOString(),
  }
}

async function loadLoopTasks(cwd: string): Promise<UnifiedTaskStatus[]> {
  const manager = new StateManager(cwd)
  await manager.initLoopSessions()
  const sessions = await manager.listLoopSessions().catch(() => [])
  return sessions.map((session) => {
    const status = session.status
    const stage = session.stages[session.currentStageIndex]
    return {
      capability: 'loop',
      sessionId: session.id,
      title: session.goal,
      status,
      kind: classifyStatus(status),
      ...(stage ? { stage } : {}),
      ...(session.lastFailureReason ? { reason: session.lastFailureReason } : {}),
      nextAction: nextActionForTask({ capability: 'loop', sessionId: session.id, status }),
      updatedAt: session.updatedAt.toISOString(),
    }
  })
}

async function loadWorkflowTasks(cwd: string, capability: WorkflowCapability): Promise<UnifiedTaskStatus[]> {
  const sessions = await listWorkflowSessions(cwd, capability)
  return sessions.map(taskStatusFromWorkflowSession)
}

export async function buildUnifiedStatusSummary(
  cwd: string,
  options: { limit?: number } = {}
): Promise<UnifiedStatusSummary> {
  const tasks = [
    ...await loadWorkflowTasks(cwd, 'harness'),
    ...await loadLoopTasks(cwd),
  ].sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))
  const limited = Number.isFinite(options.limit) ? tasks.slice(0, options.limit) : tasks
  const counts = limited.reduce((acc, task) => {
    acc[task.kind] += 1
    return acc
  }, emptyCounts())
  return { tasks: limited, counts }
}

export function formatUnifiedStatusSummary(summary: UnifiedStatusSummary): string {
  const lines = [
    'Magpie status',
    `Tasks: running=${summary.counts.running} waiting=${summary.counts.waiting} failed=${summary.counts.failed} completed=${summary.counts.completed} queued=${summary.counts.queued}`,
  ]
  if (summary.tasks.length === 0) {
    lines.push('No recent tasks found.')
    return lines.join('\n')
  }
  for (const task of summary.tasks) {
    lines.push('')
    lines.push(`${task.capability} ${task.sessionId} - ${task.status}${task.stage ? ` (${task.stage})` : ''}`)
    lines.push(`Title: ${task.title}`)
    if (task.reason) lines.push(`Reason: ${task.reason}`)
    lines.push(`Next: ${task.nextAction}`)
  }
  return lines.join('\n')
}

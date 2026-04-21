export type UnifiedTaskKind = 'running' | 'waiting' | 'failed' | 'completed' | 'queued'

export interface UnifiedTaskStatus {
  capability: 'loop' | 'harness'
  sessionId: string
  title: string
  status: string
  kind: UnifiedTaskKind
  stage?: string
  summary?: string
  reason?: string
  nextAction: string
  updatedAt?: string
}

export function classifyStatus(status: string): UnifiedTaskKind {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'blocked' || status === 'waiting_next_cycle' || status === 'waiting_retry' || status === 'paused_for_human') return 'waiting'
  if (status === 'queued') return 'queued'
  return 'running'
}

export function inspectCommand(capability: 'loop' | 'harness', sessionId: string): string {
  return `magpie ${capability} inspect ${sessionId}`
}

export function nextActionForTask(input: {
  capability: 'loop' | 'harness'
  sessionId: string
  status: string
  nextRetryAt?: string
}): string {
  if (input.nextRetryAt) return `wait for retry at ${input.nextRetryAt}`
  const kind = classifyStatus(input.status)
  if (kind === 'failed') return `inspect with ${inspectCommand(input.capability, input.sessionId)}`
  if (kind === 'waiting') return `review with ${inspectCommand(input.capability, input.sessionId)}`
  if (kind === 'completed') return 'no action required'
  if (kind === 'queued') return 'wait for the background server to pick it up'
  return 'wait for current stage to finish'
}

export function formatTaskStatus(task: UnifiedTaskStatus): string {
  const lines = [
    `${task.capability} task status`,
    `Session: ${task.sessionId}`,
    `Status: ${task.status}`,
  ]
  if (task.title) lines.push(`Title: ${task.title}`)
  if (task.stage) lines.push(`Stage: ${task.stage}`)
  if (task.summary) lines.push(`Summary: ${task.summary}`)
  if (task.reason) lines.push(`Reason: ${task.reason}`)
  lines.push(`Next: ${task.nextAction}`)
  lines.push(`Inspect: ${inspectCommand(task.capability, task.sessionId)}`)
  return lines.join('\n')
}

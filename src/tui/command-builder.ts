import { getTaskDefinition } from './tasks.js'
import { buildCommandDisplay } from './task-command-utils.js'
import type { BuiltCommand, SessionCard, TaskDraft, TaskId, TaskValues } from './types.js'

export function buildTaskCommand(taskId: TaskId, values: TaskValues): BuiltCommand {
  return getTaskDefinition(taskId).buildCommand(values)
}

export function buildCommandFromDraft(draft: TaskDraft): BuiltCommand {
  return buildTaskCommand(draft.taskId, draft.values)
}

export function buildResumeArgv(card: Pick<SessionCard, 'capability' | 'id' | 'resumeCommand' | 'status'>): string[] | undefined {
  if (card.resumeCommand) {
    return [...card.resumeCommand]
  }

  switch (card.capability) {
    case 'review':
      return ['review', '--session', card.id]
    case 'discuss':
      return ['discuss', '--resume', card.id]
    case 'trd':
      return ['trd', '--resume', card.id]
    case 'loop':
      return ['loop', 'resume', card.id]
    case 'harness':
      return card.status === 'blocked' ? ['harness', 'resume', card.id] : undefined
    default:
      return undefined
  }
}

export function buildResumeCommand(card: Pick<SessionCard, 'capability' | 'id' | 'resumeCommand' | 'status'>): BuiltCommand | undefined {
  const argv = buildResumeArgv(card)
  if (!argv) {
    return undefined
  }

  return {
    argv,
    display: buildCommandDisplay(argv),
    summary: `Resume ${card.capability} session ${card.id}`,
  }
}

export { buildCommandDisplay }

export interface TaskCreationRequest {
  entryMode: 'command'
  taskType: 'formal' | 'small'
  capability: 'loop' | 'harness'
  goal: string
  prdPath: string
  priority?: 'interactive' | 'high' | 'normal' | 'background'
}

const SUPPORTED_PRIORITIES = new Set<TaskCreationRequest['priority']>([
  'interactive',
  'high',
  'normal',
  'background',
])

export function isFeishuTaskCommandText(text: string): boolean {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] === '/magpie task'
}

export function parseFeishuTaskCommand(text: string): TaskCreationRequest {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!isFeishuTaskCommandText(text)) {
    throw new Error('unsupported command header')
  }

  const fields = Object.fromEntries(lines.slice(1).map((line) => {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      throw new Error(`invalid command line: ${line}`)
    }

    return [
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    ]
  }))

  const type = fields.type
  const goal = fields.goal
  const prdPath = fields.prd

  if (!type) throw new Error('missing required field: type')
  if (!goal) throw new Error('missing required field: goal')
  if (!prdPath) throw new Error('missing required field: prd')

  if (type !== 'formal' && type !== 'small') {
    throw new Error(`unsupported task type: ${type}`)
  }

  const priority = fields.priority
  if (priority && !SUPPORTED_PRIORITIES.has(priority as TaskCreationRequest['priority'])) {
    throw new Error(`unsupported priority: ${priority}`)
  }

  return {
    entryMode: 'command',
    taskType: type,
    capability: type === 'formal' ? 'harness' : 'loop',
    goal,
    prdPath,
    priority: priority as TaskCreationRequest['priority'] | undefined,
  }
}

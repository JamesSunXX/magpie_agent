import type { LoopTask } from '../../../core/state/index.js'

export interface LoopMilestone {
  id: string
  title: string
  scope: string
  acceptanceCriteria: string[]
  dependencies: string[]
  status: 'pending' | 'completed'
}

export interface LoopMilestonePlan {
  schemaVersion: 1
  goal: string
  sourceTrdPath?: string
  createdAt: string
  milestones: LoopMilestone[]
}

export function buildFallbackMilestonePlan(input: {
  goal: string
  tasks: LoopTask[]
  sourceTrdPath?: string
  createdAt?: string
}): LoopMilestonePlan {
  const implementationTasks = input.tasks.filter((task) => task.stage === 'implementation')
  const milestones = (implementationTasks.length > 0 ? implementationTasks : [{
    id: 'task-1',
    stage: 'implementation' as const,
    title: input.goal,
    description: `Implement ${input.goal}`,
    dependencies: [],
    successCriteria: [`${input.goal} is implemented and ready for verification.`],
  }]).map((task, index) => ({
    id: `M${index + 1}`,
    title: index === 0 ? input.goal : task.title || input.goal,
    scope: task.description || `Implement ${input.goal}`,
    acceptanceCriteria: task.successCriteria.length > 0
      ? [...task.successCriteria]
      : [`${task.title || input.goal} is implemented and verified.`],
    dependencies: index === 0 ? [] : [`M${index}`],
    status: 'pending' as const,
  }))

  return {
    schemaVersion: 1,
    goal: input.goal,
    ...(input.sourceTrdPath ? { sourceTrdPath: input.sourceTrdPath } : {}),
    createdAt: input.createdAt || new Date().toISOString(),
    milestones,
  }
}

export function renderMilestonePlanInstructions(milestonePlanPath: string): string {
  return [
    'Milestone planning requirements:',
    `- Write the machine-readable milestone plan to: ${milestonePlanPath}`,
    '- The plan must split implementation into ordered milestones that can be delivered and checked independently.',
    '- Keep each milestone small enough to implement, inspect, and resume without rereading the full TRD.',
    '- Use this exact JSON shape:',
    '```json',
    '{',
    '  "schemaVersion": 1,',
    '  "goal": "goal text",',
    '  "sourceTrdPath": "optional TRD path",',
    '  "createdAt": "ISO timestamp",',
    '  "milestones": [',
    '    {',
    '      "id": "M1",',
    '      "title": "short milestone title",',
    '      "scope": "what this milestone changes",',
    '      "acceptanceCriteria": ["observable result or check"],',
    '      "dependencies": [],',
    '      "status": "pending"',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n')
}

export function renderMilestonePlanContext(milestonePlanPath: string, milestonePlanJson: string): string {
  return [
    'Milestone implementation plan:',
    `Path: ${milestonePlanPath}`,
    '',
    'Follow the milestones in order. Finish the earliest pending milestone before starting the next one unless dependency order requires otherwise.',
    'When reporting artifacts, name the milestone ids completed or still pending.',
    '',
    '```json',
    milestonePlanJson.trim(),
    '```',
  ].join('\n')
}

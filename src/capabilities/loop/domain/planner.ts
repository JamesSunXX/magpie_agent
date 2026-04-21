import type { LoopTask } from '../../../core/state/index.js'
import type { AIProvider, Message } from '../../../platform/providers/index.js'
import type { LoopStageName } from '../../../config/types.js'
import { extractJsonBlock } from '../../../trd/renderer.js'

interface PlanJson {
  tasks: Array<{
    id?: string
    stage?: string
    title?: string
    description?: string
    dependencies?: string[]
    successCriteria?: string[]
  }>
}

const DEFAULT_PLANNER_TIMEOUT_MS = 60_000
const LEGACY_CODE_DEVELOPMENT_STAGE = 'code_development'

const STAGE_DEFAULT_COPY: Record<LoopStageName, {
  title: string
  description: (goal: string) => string
  successCriteria: string[]
}> = {
  prd_review: {
    title: 'PRD review',
    description: (goal) => `Review the PRD and lock the core problem, scope, and acceptance bar for: ${goal}`,
    successCriteria: ['PRD scope, assumptions, and open questions are clear for execution'],
  },
  domain_partition: {
    title: 'Domain partition',
    description: (goal) => `Break the work for "${goal}" into clear domain responsibilities and execution slices`,
    successCriteria: ['Domain boundaries and ownership are explicit enough to implement safely'],
  },
  trd_generation: {
    title: 'TRD generation',
    description: (goal) => `Produce or refine the technical delivery notes needed to implement: ${goal}`,
    successCriteria: ['Technical approach and key implementation decisions are documented'],
  },
  milestone_planning: {
    title: 'Milestone planning',
    description: (goal) => `Split the accepted TRD into ordered implementation milestones for: ${goal}`,
    successCriteria: ['Implementation milestones are ordered, scoped, and independently checkable'],
  },
  dev_preparation: {
    title: 'Development preparation',
    description: (goal) => `Confirm constraints, guardrails, and execution scope before changing code for: ${goal}`,
    successCriteria: ['Constraints and execution boundaries are validated before implementation starts'],
  },
  red_test_confirmation: {
    title: 'Red test confirmation',
    description: (goal) => `Establish the failing baseline that proves the target behavior is not implemented yet for: ${goal}`,
    successCriteria: ['A real failing baseline is confirmed before production changes'],
  },
  implementation: {
    title: 'Implementation',
    description: (goal) => `Make the primary code changes required to deliver: ${goal}`,
    successCriteria: ['The planned code changes are in place and aligned with the accepted scope'],
  },
  green_fixup: {
    title: 'Green fixup',
    description: (goal) => `Tidy and repair the implementation until it is ready for formal verification for: ${goal}`,
    successCriteria: ['The implementation is stabilized and ready for formal verification'],
  },
  unit_mock_test: {
    title: 'Unit and mock test',
    description: (goal) => `Run the unit and mock verification path for: ${goal}`,
    successCriteria: ['Unit and mock verification complete without blocking issues'],
  },
  integration_test: {
    title: 'Integration test',
    description: (goal) => `Run the integration verification path for: ${goal}`,
    successCriteria: ['Integration verification completes without blocking issues'],
  },
}

function getLegacyStageDefaultCopy(): typeof STAGE_DEFAULT_COPY.implementation {
  return STAGE_DEFAULT_COPY.implementation
}

function getGenericStageDefaultCopy(stage: string) {
  return {
    title: stage,
    description: (goal: string) => `Execute stage ${stage} for goal: ${goal}`,
    successCriteria: [`Stage ${stage} completed without blocking issues`],
  }
}

function getStageDefaultCopy(stage: LoopStageName | string) {
  if (stage === LEGACY_CODE_DEVELOPMENT_STAGE) {
    return getLegacyStageDefaultCopy()
  }

  return STAGE_DEFAULT_COPY[stage as LoopStageName] || getGenericStageDefaultCopy(stage)
}

function defaultTasks(goal: string, stages: LoopStageName[]): LoopTask[] {
  return stages.map((stage, idx) => ({
    id: `task-${idx + 1}`,
    stage,
    title: getStageDefaultCopy(stage).title,
    description: getStageDefaultCopy(stage).description(goal),
    dependencies: idx === 0 ? [] : [`task-${idx}`],
    successCriteria: [...getStageDefaultCopy(stage).successCriteria],
  }))
}

function normalizeTasks(goal: string, stages: LoopStageName[], parsed: PlanJson | null): LoopTask[] {
  if (!parsed?.tasks || parsed.tasks.length === 0) {
    return defaultTasks(goal, stages)
  }

  const allowed = new Set(stages)
  const tasks: LoopTask[] = []
  for (let idx = 0; idx < parsed.tasks.length; idx++) {
    const task = parsed.tasks[idx]
    const stage = (task.stage as LoopStageName) || stages[idx] || stages[stages.length - 1]
    if (!allowed.has(stage)) continue
    tasks.push({
      id: task.id || `task-${idx + 1}`,
      stage,
      title: task.title || getStageDefaultCopy(stage).title,
      description: task.description || getStageDefaultCopy(stage).description(goal),
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      successCriteria: Array.isArray(task.successCriteria) && task.successCriteria.length > 0
        ? task.successCriteria
        : [...getStageDefaultCopy(stage).successCriteria],
    })
  }

  return tasks.length > 0 ? tasks : defaultTasks(goal, stages)
}

function getPlannerTimeoutMs(): number {
  const raw = process.env.MAGPIE_LOOP_PLANNER_TIMEOUT_MS
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_PLANNER_TIMEOUT_MS
}

async function withPlannerTimeout<T>(work: Promise<T>): Promise<T> {
  const timeoutMs = getPlannerTimeoutMs()
  if (timeoutMs === 0) {
    return work
  }

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Loop planner timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function generateLoopPlan(
  planner: AIProvider,
  goal: string,
  prdPath: string,
  stages: LoopStageName[],
  planningContext?: string
): Promise<LoopTask[]> {
  const prompt = `You are a planning agent. Build an execution plan for this goal in this repository.

Goal: ${goal}
PRD path: ${prdPath}
Allowed stages: ${stages.join(', ')}
${planningContext ? `\n\n${planningContext}` : ''}

Return ONLY JSON:
\`\`\`json
{
  "tasks": [
    {
      "id": "task-1",
      "stage": "prd_review",
      "title": "...",
      "description": "...",
      "dependencies": [],
      "successCriteria": ["..."]
    }
  ]
}
\`\`\``

  const messages: Message[] = [{ role: 'user', content: prompt }]
  try {
    const response = await withPlannerTimeout(
      planner.chat(messages, undefined, { disableTools: true })
    )
    const parsed = extractJsonBlock<PlanJson>(response)
    return normalizeTasks(goal, stages, parsed)
  } catch {
    return defaultTasks(goal, stages)
  }
}

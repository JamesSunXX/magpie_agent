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

function defaultTasks(goal: string, stages: LoopStageName[]): LoopTask[] {
  return stages.map((stage, idx) => ({
    id: `task-${idx + 1}`,
    stage,
    title: stage,
    description: `Execute stage ${stage} for goal: ${goal}`,
    dependencies: idx === 0 ? [] : [`task-${idx}`],
    successCriteria: [`Stage ${stage} completed without blocking issues`],
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
      title: task.title || stage,
      description: task.description || `Execute ${stage}`,
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      successCriteria: Array.isArray(task.successCriteria) && task.successCriteria.length > 0
        ? task.successCriteria
        : [`Stage ${stage} completed`],
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

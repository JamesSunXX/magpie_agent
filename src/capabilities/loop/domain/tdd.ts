import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LoopTask } from '../../../core/state/index.js'

export interface TddEligibilityResult {
  eligible: boolean
  reasons: string[]
}

export interface RedTestResultArtifact {
  command: string
  startedAt: string
  finishedAt: string
  exitCode: number
  status: 'passed' | 'failed'
  output: string
  confirmed: boolean
  blocked?: boolean
  failureKind?: 'quality' | 'execution' | null
  firstError?: string | null
}

interface CreateTddTargetInput {
  sessionDir: string
  goal: string
  stageTasks: LoopTask[]
}

function collectText(goal: string, stageTasks: LoopTask[]): string {
  return [
    goal,
    ...stageTasks.map((task) => `${task.title}\n${task.description}\n${task.successCriteria.join('\n')}`),
  ].join('\n').toLowerCase()
}

export function assessTddEligibility(input: {
  goal: string
  stageTasks: LoopTask[]
}): TddEligibilityResult {
  const text = collectText(input.goal, input.stageTasks)

  const negativeSignals = [
    'react',
    'browser',
    'ui',
    'page',
    'layout',
    'migration',
    'database',
    'http',
    'api client',
    'external service',
  ]
  if (negativeSignals.some((signal) => text.includes(signal))) {
    return {
      eligible: false,
      reasons: ['当前任务更像界面、迁移或外部集成，不走第一版测试先行。'],
    }
  }

  const positiveSignals = [
    'utility',
    'formatter',
    'format',
    'normalize',
    'transform',
    'mapper',
    'parse',
    'pure',
    'function',
  ]
  if (positiveSignals.some((signal) => text.includes(signal))) {
    return {
      eligible: true,
      reasons: ['当前任务符合纯函数或转换逻辑特征。'],
    }
  }

  return {
    eligible: false,
    reasons: ['当前任务未命中第一版测试先行的简单任务特征。'],
  }
}

export async function createTddTarget(input: CreateTddTargetInput): Promise<string> {
  const tddDir = join(input.sessionDir, 'tdd')
  const targetPath = join(tddDir, 'target.md')
  const content = [
    '# TDD Target',
    '',
    `Goal: ${input.goal}`,
    '',
    'Tasks:',
    ...input.stageTasks.map((task) => `- ${task.title}: ${task.description}`),
  ].join('\n')

  await mkdir(tddDir, { recursive: true })
  await writeFile(targetPath, `${content}\n`, 'utf-8')
  return targetPath
}

export async function recordRedTestResult(sessionDir: string, result: RedTestResultArtifact): Promise<string> {
  const tddDir = join(sessionDir, 'tdd')
  const resultPath = join(tddDir, 'red-test-result.json')
  await mkdir(tddDir, { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8')
  return resultPath
}

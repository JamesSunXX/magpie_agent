import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getRepoMagpieDir } from '../../../platform/paths.js'
import type { LoopStageName } from '../../../config/types.js'
import type { LoopTask } from '../../../core/state/index.js'
import type { TrdConstraintsArtifact } from '../../trd/types.js'

const LEGACY_CODE_DEVELOPMENT_STAGE = 'code_development' as unknown as LoopStageName

function isDevelopmentCompatibilityStage(stage: LoopStageName): boolean {
  return stage === 'implementation' || stage === LEGACY_CODE_DEVELOPMENT_STAGE
}

export interface ConstraintCheckResult {
  status: 'pass' | 'needs_revision' | 'blocked'
  reasons: string[]
  matchedRuleIds: string[]
}

interface EvaluatePlanningConstraintsInput {
  stage: LoopStageName
  goal: string
  stageTasks: LoopTask[]
  constraints: TrdConstraintsArtifact
}

function buildTaskText(goal: string, stageTasks: LoopTask[]): string {
  return [
    goal,
    ...stageTasks.map((task) => [
      task.title,
      task.description,
      ...task.successCriteria,
    ].join('\n')),
  ].join('\n').toLowerCase()
}

export async function loadLoopConstraints(cwd: string): Promise<TrdConstraintsArtifact | null> {
  try {
    const filePath = join(getRepoMagpieDir(cwd), 'constraints.json')
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as TrdConstraintsArtifact
  } catch {
    return null
  }
}

export async function createConstraintsSnapshot(
  sessionDir: string,
  constraints: TrdConstraintsArtifact
): Promise<string> {
  const snapshotPath = join(sessionDir, 'constraints.snapshot.json')
  await mkdir(sessionDir, { recursive: true })
  await writeFile(snapshotPath, `${JSON.stringify(constraints, null, 2)}\n`, 'utf-8')
  return snapshotPath
}

export function evaluatePlanningConstraints(input: EvaluatePlanningConstraintsInput): ConstraintCheckResult {
  if (!isDevelopmentCompatibilityStage(input.stage) || input.constraints.rules.length === 0) {
    return {
      status: 'pass',
      reasons: [],
      matchedRuleIds: [],
    }
  }

  const text = buildTaskText(input.goal, input.stageTasks)
  const blockedReasons: string[] = []
  const needsRevisionReasons: string[] = []
  const matchedRuleIds: string[] = []

  for (const rule of input.constraints.rules) {
    if (rule.checkType === 'forbidden_dependency') {
      const matched = rule.forbidden.find((item) => text.includes(item.toLowerCase()))
      if (matched) {
        matchedRuleIds.push(rule.id)
        blockedReasons.push(`命中禁止依赖规则：${matched}`)
      }
      continue
    }

    if (rule.checkType === 'required_path_prefix') {
      const hasExpectedPath = rule.expected.some((prefix) => text.includes(prefix.toLowerCase()))
      if (!hasExpectedPath) {
        matchedRuleIds.push(rule.id)
        needsRevisionReasons.push(`当前计划没有体现要求路径：${rule.expected.join(', ')}`)
      }
    }
  }

  if (blockedReasons.length > 0) {
    return {
      status: 'blocked',
      reasons: blockedReasons,
      matchedRuleIds,
    }
  }

  if (needsRevisionReasons.length > 0) {
    return {
      status: 'needs_revision',
      reasons: needsRevisionReasons,
      matchedRuleIds,
    }
  }

  return {
    status: 'pass',
    reasons: [],
    matchedRuleIds: [],
  }
}

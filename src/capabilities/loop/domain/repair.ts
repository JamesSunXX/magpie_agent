import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LoopStageName } from '../../../config/types.js'
import type { LoopReworkOrigin } from '../../../state/types.js'
import type { ClassifiedTestResult } from './test-execution.js'

interface AdvanceRepairStateInput {
  failureKind: 'quality' | 'execution'
  repairAttemptCount: number
  executionRetryCount: number
}

export interface RepairStateTransition {
  currentLoopState: 'revising' | 'retrying_execution' | 'blocked_for_human'
  repairAttemptCount: number
  executionRetryCount: number
  blockedForHuman: boolean
}

export function advanceRepairState(input: AdvanceRepairStateInput): RepairStateTransition {
  if (input.failureKind === 'quality') {
    const repairAttemptCount = input.repairAttemptCount + 1
    return {
      currentLoopState: repairAttemptCount >= 3 ? 'blocked_for_human' : 'revising',
      repairAttemptCount,
      executionRetryCount: input.executionRetryCount,
      blockedForHuman: repairAttemptCount >= 3,
    }
  }

  const executionRetryCount = input.executionRetryCount + 1
  return {
    currentLoopState: executionRetryCount >= 2 ? 'blocked_for_human' : 'retrying_execution',
    repairAttemptCount: input.repairAttemptCount,
    executionRetryCount,
    blockedForHuman: executionRetryCount >= 2,
  }
}

export function resolveLoopReworkOrigin(stage: LoopStageName): LoopReworkOrigin {
  if (stage === 'unit_mock_test') {
    return 'verification'
  }

  if (stage === 'integration_test') {
    return 'integration'
  }

  return 'implementation'
}

export async function writeRepairArtifacts(input: {
  sessionDir: string
  attemptNumber: number
  summary: string
  classifiedResult: ClassifiedTestResult
}): Promise<{
  attemptPath: string
  openIssuesPath: string
  evidencePath: string
}> {
  const repairsDir = join(input.sessionDir, 'repairs')
  const evidenceDir = join(repairsDir, 'evidence')
  const attemptPath = join(repairsDir, `attempt-${input.attemptNumber}.json`)
  const openIssuesPath = join(repairsDir, 'open-issues.md')
  const evidencePath = join(evidenceDir, `attempt-${input.attemptNumber}.txt`)

  await mkdir(evidenceDir, { recursive: true })
  await writeFile(attemptPath, `${JSON.stringify(input.classifiedResult, null, 2)}\n`, 'utf-8')
  await writeFile(openIssuesPath, `# Open Issues\n\n- ${input.summary}\n`, 'utf-8')
  await writeFile(evidencePath, `${input.classifiedResult.output}\n`, 'utf-8')

  return {
    attemptPath,
    openIssuesPath,
    evidencePath,
  }
}

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CommandRunResult } from '../../workflows/shared/runtime.js'
import type { ResolvedCommandSafetyConfig } from '../../workflows/shared/runtime.js'
import { runSafeCommand } from '../../workflows/shared/runtime.js'
import { classifyFailureCategory } from '../../../core/failures/classifier.js'
import type { FailureCategory } from '../../../core/failures/types.js'

export interface StructuredTestResult {
  command: string
  startedAt: string
  finishedAt: string
  exitCode: number
  status: 'passed' | 'failed'
  output: string
  blocked: boolean
}

export interface ClassifiedTestResult extends StructuredTestResult {
  failureKind: 'quality' | 'execution' | null
  failedTests: string[]
  firstError: string | null
}

function extractFailedTests(output: string): string[] {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines
    .filter((line) => line.startsWith('FAIL '))
    .map((line) => line.replace(/^FAIL\s+/, ''))
}

function extractFirstError(output: string): string | null {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.find((line) =>
    line.toLowerCase().includes('error')
    || line.toLowerCase().includes('command not found')
    || line.toLowerCase().includes('blocked')
    || line.toLowerCase().includes('enoent')
  ) || null
}

export function classifyStructuredTestResult(result: StructuredTestResult): ClassifiedTestResult {
  const lower = result.output.toLowerCase()
  const executionFailure = result.blocked
    || lower.includes('dangerous command blocked')
    || lower.includes('command not found')
    || lower.includes('enoent')
    || lower.includes('timeout')
    || lower.includes('timed out')
    || lower.includes('etimedout')
    || lower.includes('429')
    || lower.includes('rate limit')
    || lower.includes('unsupported shell metacharacters')

  return {
    ...result,
    failureKind: result.status === 'passed'
      ? null
      : executionFailure
        ? 'execution'
        : 'quality',
    failedTests: extractFailedTests(result.output),
    firstError: extractFirstError(result.output),
  }
}

export function classifyStructuredTestFailureCategory(
  result: ClassifiedTestResult,
  stage: string
): FailureCategory {
  return classifyFailureCategory({
    capability: 'loop',
    stage,
    reason: result.status === 'passed'
      ? 'Test command passed.'
      : result.failureKind === 'execution'
        ? result.firstError || 'Test command failed before assertions ran.'
        : result.failedTests[0] || 'Implementation still fails tests.',
    rawError: result.output,
    metadata: {
      failureKind: result.failureKind,
      failedTests: result.failedTests,
    },
  })
}

export function runStructuredTestCommand(
  cwd: string,
  command: string,
  safety: ResolvedCommandSafetyConfig
): ClassifiedTestResult {
  const startedAt = new Date()
  const result: CommandRunResult = runSafeCommand(cwd, command, {
    safety,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  })
  const finishedAt = new Date()

  return classifyStructuredTestResult({
    command,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    exitCode: result.passed ? 0 : 1,
    status: result.passed ? 'passed' : 'failed',
    output: result.output,
    blocked: result.blocked === true,
  })
}

export async function recordStructuredTestResult(
  sessionDir: string,
  fileName: string,
  result: ClassifiedTestResult
): Promise<string> {
  const tddDir = join(sessionDir, 'tdd')
  const resultPath = join(tddDir, fileName)
  await mkdir(tddDir, { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8')
  return resultPath
}

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface LoopMrAttemptResult {
  status: 'created' | 'manual_follow_up' | 'skipped'
  branchName?: string
  url?: string
  reason?: string
  needsHuman: boolean
  rawOutput?: string
}

export function extractMergeRequestUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/\S+\/-\/merge_requests\/\d+/)
  return match?.[0]
}

export async function createLoopMr(input: {
  cwd: string
  branchName: string
  goal: string
}): Promise<LoopMrAttemptResult> {
  try {
    const repoScriptPath = join(input.cwd, 'scripts', 'gitlab_mr_sync.sh')
    const rawOutput = existsSync(repoScriptPath)
      ? execFileSync(repoScriptPath, [], { cwd: input.cwd, encoding: 'utf-8' })
      : execFileSync('git', [
        'push',
        '-u',
        'origin',
        input.branchName,
        '-o',
        'merge_request.create',
      ], { cwd: input.cwd, encoding: 'utf-8' })

    const url = extractMergeRequestUrl(rawOutput)
    if (url) {
      return {
        status: 'created',
        branchName: input.branchName,
        url,
        needsHuman: false,
        rawOutput,
      }
    }

    return {
      status: 'manual_follow_up',
      branchName: input.branchName,
      reason: 'MR url not found in command output.',
      needsHuman: true,
      rawOutput,
    }
  } catch (error) {
    return {
      status: 'manual_follow_up',
      branchName: input.branchName,
      reason: error instanceof Error ? error.message : String(error),
      needsHuman: true,
    }
  }
}

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { CapabilityContext } from '../../../core/capability/context.js'
import type { StatsInput, StatsPrepared } from '../types.js'

export async function prepareStats(input: StatsInput, ctx: CapabilityContext): Promise<StatsPrepared> {
  const cwd = resolve(ctx.cwd)
  const repoName = cwd.split('/').pop() || 'repo'
  const historyDir = join(cwd, '.magpie', 'history', repoName)
  const rawSince = input.since ?? 30
  const windowDays = Number.isFinite(rawSince) && rawSince > 0 ? Math.floor(rawSince) : 30
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const cutoffTimestamp = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const requestedFormat = input.format === 'json' ? 'json' : 'markdown'

  if (!existsSync(cwd)) {
    throw new Error(`Path does not exist: ${cwd}`)
  }

  return {
    cwd,
    repoName,
    historyDir,
    windowDays,
    cutoffTimestamp,
    format: requestedFormat,
  }
}

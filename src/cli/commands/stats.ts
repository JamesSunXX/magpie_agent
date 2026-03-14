import { Command } from 'commander'
import chalk from 'chalk'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type { StatsInput, StatsPrepared, StatsResult, StatsSummary } from '../../capabilities/stats/types.js'

export const statsCommand = new Command('stats')
  .description('Show review statistics for the current repository')
  .option('-c, --config <path>', 'Path to config file')
  .option('--since <days>', 'Show stats for last N days', (value) => Number.parseInt(value, 10), 30)
  .option('-f, --format <format>', 'Output format (markdown|json)', 'markdown')
  .action(async (options: { config?: string; since?: number; format?: 'markdown' | 'json' }) => {
    const registry = createDefaultCapabilityRegistry()
    const capability = getTypedCapability<StatsInput, StatsPrepared, StatsResult, StatsSummary>(registry, 'stats')
    const ctx = createCapabilityContext({
      cwd: process.cwd(),
      configPath: options.config,
      metadata: {
        format: options.format,
      },
    })

    try {
      await runCapability(capability, {
        since: options.since,
        format: options.format,
      }, ctx)
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      process.exitCode = 1
    }
  })

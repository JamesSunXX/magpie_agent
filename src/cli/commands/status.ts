import { Command } from 'commander'
import { buildUnifiedStatusSummary, formatUnifiedStatusSummary } from '../../capabilities/workflows/shared/status-summary.js'

export const statusCommand = new Command('status')
  .description('Show recent Magpie task state and next actions')
  .option('--limit <number>', 'Maximum number of tasks to show', (value) => Number.parseInt(value, 10), 8)
  .action(async (options: { limit?: number }) => {
    const summary = await buildUnifiedStatusSummary(process.cwd(), {
      limit: Number.isFinite(options.limit) ? options.limit : 8,
    })
    console.log(formatUnifiedStatusSummary(summary))
  })

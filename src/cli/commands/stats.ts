import { Command } from 'commander'
import chalk from 'chalk'
import { HistoryTracker } from '../../core/history/tracker.js'

export const statsCommand = new Command('stats')
  .description('Show review statistics for the current repository')
  .option('--since <days>', 'Show stats for last N days', '30')
  .action(async () => {
    const repoName = process.cwd().split('/').pop() || 'repo'
    new HistoryTracker(process.cwd())

    console.log(chalk.bgBlue.white.bold(` ${repoName} Review Stats `))
    console.log(chalk.dim('Coming soon: aggregate statistics across all reviews'))
    console.log(chalk.dim(`Use 'magpie review --local' to start building review history`))
  })

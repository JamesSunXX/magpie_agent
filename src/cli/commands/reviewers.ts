import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig } from '../../platform/config/loader.js'
import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface ConfiguredReviewer {
  id: string
  model: string
  agent?: string
}

export function listConfiguredReviewers(config: MagpieConfigV2, model?: string): ConfiguredReviewer[] {
  const normalized = model?.trim().toLowerCase()

  return Object.entries(config.reviewers)
    .filter(([, reviewer]) => {
      if (!normalized) return true
      return reviewer.model.toLowerCase() === normalized
    })
    .map(([id, reviewer]) => ({
      id,
      model: reviewer.model,
      agent: reviewer.agent,
    }))
}

interface ReviewerListOptions {
  config?: string
  model?: string
  json?: boolean
}

const listReviewersCommand = new Command('list')
  .description('List configured reviewers')
  .option('-c, --config <path>', 'Path to config file')
  .option('-m, --model <model>', 'Filter by model name (e.g., kiro)')
  .option('--json', 'Output in JSON format')
  .action((options: ReviewerListOptions) => {
    try {
      const config = loadConfig(options.config)
      const reviewers = listConfiguredReviewers(config, options.model)

      if (options.json) {
        console.log(JSON.stringify(reviewers, null, 2))
        return
      }

      if (reviewers.length === 0) {
        console.log(options.model
          ? chalk.yellow(`No reviewers configured with model "${options.model}"`)
          : chalk.yellow('No reviewers configured'))
        return
      }

      const title = options.model ? ` Reviewers (model=${options.model}) ` : ' Configured Reviewers '
      console.log(chalk.bgBlue.white.bold(title))
      console.log(chalk.dim(`  ${'ID'.padEnd(20)} ${'MODEL'.padEnd(16)} AGENT`))
      for (const reviewer of reviewers) {
        console.log(`  ${chalk.cyan(reviewer.id.padEnd(20))} ${reviewer.model.padEnd(16)} ${reviewer.agent || '-'}`)
      }
      console.log(chalk.dim(`\n  Total: ${reviewers.length}`))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(chalk.red(`Error: ${message}`))
      process.exit(1)
    }
  })

export const reviewersCommand = new Command('reviewers')
  .description('Inspect reviewer configuration')
  .addCommand(listReviewersCommand)

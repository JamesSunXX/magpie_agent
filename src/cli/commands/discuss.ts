import { Command } from 'commander'
import chalk from 'chalk'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  DiscussCapabilityInput,
  DiscussOptions,
  DiscussExecutionResult,
  DiscussPreparedInput,
  DiscussSummaryOutput,
} from '../../capabilities/discuss/types.js'

export const discussCommand = new Command('discuss')
  .description('Discuss any topic with multiple AI reviewers through adversarial debate')
  .argument('[topic]', 'Topic to discuss (text or file path)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-r, --rounds <number>', 'Maximum debate rounds', '5')
  .option('-i, --interactive', 'Interactive mode')
  .option('-o, --output <file>', 'Output to file')
  .option('-f, --format <format>', 'Output format (markdown|json)', 'markdown')
  .option('--no-converge', 'Disable convergence detection')
  .option('--reviewers <ids>', 'Comma-separated reviewer IDs')
  .option('-a, --all', 'Use all reviewers')
  .option('-d, --devil-advocate', "Add a Devil's Advocate to challenge consensus")
  .option('--list', 'List all discuss sessions')
  .option('--resume <id>', 'Resume a discuss session')
  .action(async (topic: string | undefined, options: DiscussOptions) => {
    const registry = createDefaultCapabilityRegistry()
    const capability = getTypedCapability<
      DiscussCapabilityInput,
      DiscussPreparedInput,
      DiscussExecutionResult,
      DiscussSummaryOutput
    >(registry, 'discuss')

    const ctx = createCapabilityContext({
      cwd: process.cwd(),
      configPath: options.config,
      metadata: {
        format: options.format,
      },
    })

    try {
      const { result } = await runCapability(capability, {
        topic: topic || '',
        options,
      }, ctx)

      if (result && result.status !== 'completed') {
        process.exitCode = result.payload?.exitCode ?? 1
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      process.exitCode = 1
    }
  })

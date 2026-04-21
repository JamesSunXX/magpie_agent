import { Command } from 'commander'
import chalk from 'chalk'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  TrdCapabilityInput,
  TrdExecutionResult,
  TrdOptions,
  TrdPreparedInput,
  TrdSummaryOutput,
} from '../../capabilities/trd/types.js'

export const trdCommand = new Command('trd')
  .description('Generate TRD from PRD markdown with multi-role debate')
  .argument('[prd]', 'Path to PRD markdown (or follow-up text when using --resume)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-r, --rounds <number>', 'Maximum debate rounds')
  .option('-i, --interactive', 'Interactive mode in domain debates')
  .option('--no-converge', 'Disable convergence detection')
  .option('--reviewers <ids>', 'Comma-separated reviewer IDs')
  .option('-a, --all', 'Use all reviewers')
  .option('-o, --output <file>', 'Output TRD markdown file path')
  .option('--questions-output <file>', 'Output open questions markdown file path')
  .option('--domain-overview-only', 'Only generate domain overview and draft domain boundaries')
  .option('--domains-file <path>', 'Use confirmed domains YAML and skip interactive confirmation')
  .option('--auto-accept-domains', 'Auto-accept draft domains without manual confirmation')
  .option('--list', 'List TRD sessions')
  .option('--resume <id>', 'Resume TRD session with follow-up revision')
  .action(async (prdPath: string | undefined, options: TrdOptions) => {
    const registry = createDefaultCapabilityRegistry({ configPath: options.config })
    const capability = getTypedCapability<
      TrdCapabilityInput,
      TrdPreparedInput,
      TrdExecutionResult,
      TrdSummaryOutput
    >(registry, 'trd')

    const ctx = createCapabilityContext({
      cwd: process.cwd(),
      configPath: options.config,
    })

    try {
      const { result } = await runCapability(capability, {
        prdPath: prdPath || '',
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

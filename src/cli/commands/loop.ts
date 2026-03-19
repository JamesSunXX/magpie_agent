import { Command } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  LoopCapabilityInput,
  LoopExecutionResult,
  LoopPreparedInput,
  LoopSummaryOutput,
} from '../../capabilities/loop/types.js'

interface SharedLoopOptions {
  config?: string
  waitHuman?: boolean
  dryRun?: boolean
  maxIterations?: number
  planningItem?: string
  planningProject?: string
}

async function runLoop(input: LoopCapabilityInput, options: SharedLoopOptions): Promise<void> {
  const registry = createDefaultCapabilityRegistry()
  const capability = getTypedCapability<
    LoopCapabilityInput,
    LoopPreparedInput,
    LoopExecutionResult,
    LoopSummaryOutput
  >(registry, 'loop')

  const ctx = createCapabilityContext({
    cwd: process.cwd(),
    configPath: options.config,
  })

  const { output } = await runCapability(capability, input, ctx)
  console.log(output.summary)

  if (input.mode === 'list' && Array.isArray(output.details)) {
    if (output.details.length === 0) {
      console.log('No loop sessions found.')
      return
    }

    for (const session of output.details) {
      console.log(`${session.id}\t${session.status}\t${session.updatedAt.toISOString()}\t${session.title}`)
    }
  }

  if ((input.mode === 'run' || input.mode === 'resume') && output.details && !Array.isArray(output.details)) {
    const session = output.details
    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (session.branchName) {
      console.log(`Branch: ${session.branchName}`)
    }
    console.log(`Human confirmation file: ${session.artifacts.humanConfirmationPath}`)
  }
}

export const loopCommand = new Command('loop')
  .description('Goal-driven agent loop execution')

loopCommand
  .command('run')
  .description('Run loop from a goal')
  .argument('<goal>', 'Goal to execute')
  .requiredOption('--prd <path>', 'PRD markdown path')
  .option('-c, --config <path>', 'Path to config file')
  .option('--wait-human', 'Wait for human confirmation (default)', true)
  .option('--no-wait-human', 'Do not wait for human confirmation; pause and exit')
  .option('--dry-run', 'Do not execute mutating stage actions')
  .option('--planning-item <key>', 'Override planning item key for remote context lookup')
  .option('--planning-project <key>', 'Override planning project key for remote context lookup')
  .option('--max-iterations <number>', 'Maximum iterations when waiting for human decision', (v) => Number.parseInt(v, 10))
  .action(async (goal: string, options: SharedLoopOptions & { prd: string }) => {
    await runLoop({
      mode: 'run',
      goal,
      prdPath: options.prd,
      planningItemKey: options.planningItem,
      planningProjectKey: options.planningProject,
      waitHuman: options.waitHuman,
      dryRun: options.dryRun,
      maxIterations: Number.isFinite(options.maxIterations) ? options.maxIterations : undefined,
    }, options)
  })

loopCommand
  .command('resume')
  .description('Resume paused loop session')
  .argument('<sessionId>', 'Loop session ID or prefix')
  .option('-c, --config <path>', 'Path to config file')
  .option('--wait-human', 'Wait for human confirmation (default)', true)
  .option('--no-wait-human', 'Do not wait for human confirmation; pause and exit')
  .option('--dry-run', 'Do not execute mutating stage actions')
  .action(async (sessionId: string, options: SharedLoopOptions) => {
    await runLoop({
      mode: 'resume',
      sessionId,
      waitHuman: options.waitHuman,
      dryRun: options.dryRun,
    }, options)
  })

loopCommand
  .command('list')
  .description('List loop sessions')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: SharedLoopOptions) => {
    await runLoop({ mode: 'list' }, options)
  })

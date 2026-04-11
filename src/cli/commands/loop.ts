import { Command } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import { StateManager } from '../../state/state-manager.js'
import type {
  LoopCapabilityInput,
  LoopExecutionResult,
  LoopPreparedInput,
  LoopSummaryOutput,
} from '../../capabilities/loop/types.js'
import type { ComplexityTier } from '../../config/types.js'
import { printKnowledgeInspectView, printKnowledgeSummary } from './knowledge.js'

interface SharedLoopOptions {
  config?: string
  waitHuman?: boolean
  dryRun?: boolean
  maxIterations?: number
  planningItem?: string
  planningProject?: string
  complexity?: ComplexityTier
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
    await printKnowledgeSummary(session.artifacts)
  }
}

async function loadLoopSessionByPrefix(sessionId: string, cwd: string) {
  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  const sessions = await stateManager.listLoopSessions()
  const matches = sessions.filter((item) => item.id === sessionId || item.id.startsWith(sessionId))

  if (matches.length === 0) {
    return null
  }
  if (matches.length > 1) {
    throw new Error(`Multiple loop sessions match "${sessionId}", use full id`)
  }
  return matches[0]
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
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
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
      complexity: options.complexity,
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
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .action(async (sessionId: string, options: SharedLoopOptions) => {
    await runLoop({
      mode: 'resume',
      sessionId,
      waitHuman: options.waitHuman,
      dryRun: options.dryRun,
      complexity: options.complexity,
    }, options)
  })

loopCommand
  .command('inspect')
  .description('Show the knowledge summary for a loop session')
  .argument('<sessionId>', 'Loop session ID or prefix')
  .action(async (sessionId: string) => {
    try {
      const session = await loadLoopSessionByPrefix(sessionId, process.cwd())
      if (!session) {
        console.error(`Loop session not found: ${sessionId}`)
        process.exitCode = 1
        return
      }
      await printKnowledgeInspectView(session.artifacts)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  })

loopCommand
  .command('list')
  .description('List loop sessions')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: SharedLoopOptions) => {
    await runLoop({ mode: 'list' }, options)
  })

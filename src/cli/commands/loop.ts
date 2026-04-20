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
import type { ExecutionHost } from '../../platform/integrations/operations/types.js'
import { printKnowledgeInspectView, printKnowledgeSummary } from './knowledge.js'
import { printDocumentPlanSummary } from './document-plan.js'
import type { KnowledgeState } from '../../knowledge/runtime.js'
import { formatLocalDateTime } from '../../shared/utils/time.js'
import { launchMagpieInTmux } from './tmux-launch.js'
import { applyLoopConfirmationDecision, type ConfirmationDecisionOptions } from './human-confirmation-actions.js'

interface SharedLoopOptions {
  config?: string
  waitHuman?: boolean
  dryRun?: boolean
  maxIterations?: number
  planningItem?: string
  planningProject?: string
  complexity?: ComplexityTier
  host?: ExecutionHost
}

interface LoopConfirmOptions extends Pick<SharedLoopOptions, 'config'> {
  approve?: boolean
  reject?: boolean
  reason?: string
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
      console.log(`${session.id}\t${session.status}\t${formatLocalDateTime(session.updatedAt)}\t${session.title}`)
    }
  }

  if ((input.mode === 'run' || input.mode === 'resume') && output.details && !Array.isArray(output.details)) {
    const session = output.details
    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (session.branchName) {
      console.log(`Branch: ${session.branchName}`)
    }
    if (session.artifacts.workspacePath) {
      console.log(`Workspace: ${session.artifacts.workspacePath} (${session.artifacts.workspaceMode || 'current'})`)
    }
    if (session.artifacts.executionHost) {
      console.log(`Host: ${session.artifacts.executionHost}`)
    }
    if (session.artifacts.tmuxSession || session.artifacts.tmuxWindow || session.artifacts.tmuxPane) {
      console.log(`Tmux: session=${session.artifacts.tmuxSession || '-'} window=${session.artifacts.tmuxWindow || '-'} pane=${session.artifacts.tmuxPane || '-'}`)
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

function legacyLoopKnowledgeState(session: Awaited<ReturnType<typeof loadLoopSessionByPrefix>> extends infer T ? NonNullable<T> : never): Partial<KnowledgeState> {
  if (session.status === 'completed') {
    return {
      currentStage: 'completed',
      nextAction: 'No further action.',
      currentBlocker: 'None.',
      lastReliableResult: session.stageResults.at(-1)?.summary || session.goal,
    }
  }

  if (session.status === 'failed') {
    return {
      currentStage: 'failed',
      nextAction: 'Inspect failure details and replan.',
      currentBlocker: 'Session is marked failed.',
      lastReliableResult: session.stageResults.at(-1)?.summary || session.goal,
    }
  }

  const stage = session.stages[session.currentStageIndex] || session.stages.at(-1) || 'running'
  return {
    currentStage: stage,
    nextAction: session.status === 'paused_for_human' ? 'Wait for human confirmation.' : `Resume ${stage}.`,
    currentBlocker: session.status === 'paused_for_human' ? 'Waiting for human confirmation.' : 'Legacy session has no persisted state card.',
    lastReliableResult: session.stageResults.at(-1)?.summary || session.goal,
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
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .option('--host <host>', 'Execution host (foreground|tmux)')
  .option('--planning-item <key>', 'Override planning item key for remote context lookup')
  .option('--planning-project <key>', 'Override planning project key for remote context lookup')
  .option('--max-iterations <number>', 'Maximum iterations when waiting for human decision', (v) => Number.parseInt(v, 10))
  .action(async (goal: string, options: SharedLoopOptions & { prd: string }) => {
    if (options.host === 'tmux' && !process.env.VITEST) {
      const launch = await launchMagpieInTmux({
        capability: 'loop',
        cwd: process.cwd(),
        configPath: options.config,
        argv: [
          'loop',
          'run',
          goal,
          '--prd',
          options.prd,
          '--host',
          'foreground',
          ...(options.config ? ['--config', options.config] : []),
          ...(options.waitHuman === false ? ['--no-wait-human'] : []),
          ...(options.dryRun ? ['--dry-run'] : []),
          ...(options.complexity ? ['--complexity', options.complexity] : []),
          ...(options.planningItem ? ['--planning-item', options.planningItem] : []),
          ...(options.planningProject ? ['--planning-project', options.planningProject] : []),
          ...(Number.isFinite(options.maxIterations) ? ['--max-iterations', String(options.maxIterations)] : []),
        ],
      })

      console.log(`Session: ${launch.sessionId}`)
      console.log('Host: tmux')
      console.log(`Tmux: session=${launch.tmuxSession} window=${launch.tmuxWindow || '-'} pane=${launch.tmuxPane || '-'}`)
      return
    }

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
      host: options.host,
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
  .command('confirm')
  .description('Approve or reject the latest pending human confirmation for a loop session')
  .argument('<sessionId>', 'Loop session ID or prefix')
  .option('-c, --config <path>', 'Path to config file')
  .option('--approve', 'Approve the latest pending confirmation and continue automatically')
  .option('--reject', 'Reject the latest pending confirmation and trigger auto discussion')
  .option('--reason <text>', 'Reason for rejection')
  .action(async (sessionId: string, options: LoopConfirmOptions) => {
    try {
      const session = await loadLoopSessionByPrefix(sessionId, process.cwd())
      if (!session) {
        console.error(`Loop session not found: ${sessionId}`)
        process.exitCode = 1
        return
      }

      await applyLoopConfirmationDecision(process.cwd(), session, options)

      if (options.approve) {
        await runLoop({
          mode: 'resume',
          sessionId: session.id,
          waitHuman: false,
        }, options)
        return
      }

      console.log(`Rejected pending human confirmation for ${session.id}.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
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
      await printDocumentPlanSummary(session.artifacts.documentPlanPath)
      const latestHandoff = [...session.stageResults]
        .reverse()
        .find((stageResult) => stageResult.handoffPath)
        ?.handoffPath
      if (latestHandoff) {
        console.log(`Latest handoff: ${latestHandoff}`)
      }
      await printKnowledgeInspectView(session.artifacts, legacyLoopKnowledgeState(session))
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

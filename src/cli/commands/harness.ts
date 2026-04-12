import { readFile } from 'fs/promises'
import { Command, InvalidArgumentError } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import {
  listWorkflowSessions,
  loadWorkflowSession,
} from '../../capabilities/workflows/shared/runtime.js'
import {
  enqueueHarnessSession,
  isHarnessServerRunning,
} from '../../capabilities/workflows/harness-server/runtime.js'
import type {
  HarnessInput,
  HarnessPreparedInput,
  HarnessPriority,
  HarnessResult,
  HarnessSummary,
} from '../../capabilities/workflows/harness/types.js'
import type { WorkflowSession } from '../../capabilities/workflows/shared/runtime.js'
import { createHarnessProgressReporter, followHarnessEventStream, formatHarnessEventLine } from './harness-progress.js'
import { printKnowledgeInspectView, printKnowledgeSummary } from './knowledge.js'
import { printDocumentPlanSummary } from './document-plan.js'
import type { KnowledgeState } from '../../knowledge/runtime.js'
import type { ExecutionHost } from '../../platform/integrations/operations/types.js'
import { launchMagpieInTmux } from './tmux-launch.js'

interface HarnessCommandOptions {
  config?: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
  complexity?: HarnessInput['complexity']
  host?: ExecutionHost
  priority?: HarnessPriority
}

interface PersistedHarnessResumeEvidence {
  input?: HarnessInput
  configPath?: string
}

const HARNESS_PRIORITIES = ['interactive', 'high', 'normal', 'background'] as const

function parseHarnessPriority(value: string): HarnessPriority {
  if ((HARNESS_PRIORITIES as readonly string[]).includes(value)) {
    return value as HarnessPriority
  }
  throw new InvalidArgumentError(`Priority must be one of: ${HARNESS_PRIORITIES.join(', ')}`)
}

function legacyHarnessKnowledgeState(session: NonNullable<Awaited<ReturnType<typeof loadWorkflowSession>>>): Partial<KnowledgeState> {
  if (session.status === 'completed') {
    return {
      currentStage: 'completed',
      nextAction: 'No further action.',
      currentBlocker: 'None.',
      lastReliableResult: session.summary,
    }
  }

  if (session.status === 'failed') {
    return {
      currentStage: 'failed',
      nextAction: 'Inspect failure details and replan.',
      currentBlocker: session.summary,
      lastReliableResult: session.summary,
    }
  }

  if (session.status === 'blocked') {
    return {
      currentStage: session.currentStage || 'developing',
      nextAction: '处理人工确认后恢复当前阶段。',
      currentBlocker: session.summary,
      lastReliableResult: session.summary,
    }
  }

  return {
    currentStage: session.currentStage || 'in_progress',
    nextAction: session.currentStage === 'reviewing' ? 'Resume the current review cycle.' : 'Resume the harness workflow.',
    currentBlocker: 'Legacy session has no persisted state card.',
    lastReliableResult: session.summary,
  }
}

interface LoopActivitySnapshot {
  timestamp: string
  line: string
  stage?: string
}

async function loadLatestLoopActivity(loopEventsPath: string | undefined): Promise<LoopActivitySnapshot | null> {
  if (!loopEventsPath) {
    return null
  }

  const raw = await readFile(loopEventsPath, 'utf-8').catch(() => '')
  if (!raw) {
    return null
  }

  const lines = raw.trim().split('\n').reverse()
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    try {
      const event = JSON.parse(line) as {
        ts?: string
        event?: string
        stage?: string
        cycle?: number
        summary?: string
        provider?: string
        progressType?: string
      }
      if (!event.ts || !event.event) {
        continue
      }
      const displayEvent = {
        ts: event.ts,
        event: event.event,
        ...(event.stage ? { stage: event.stage } : {}),
        ...(Number.isFinite(event.cycle) ? { cycle: event.cycle } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.progressType ? { progressType: event.progressType } : {}),
      }
      return {
        timestamp: event.ts,
        line: formatHarnessEventLine(displayEvent),
        stage: event.stage,
      }
    } catch {
      continue
    }
  }

  return null
}

async function runHarness(input: HarnessInput, options: HarnessCommandOptions): Promise<void> {
  return runHarnessWithSession(input, options)
}

async function runHarnessWithSession(
  input: HarnessInput,
  options: HarnessCommandOptions,
  sessionId?: string
): Promise<void> {
  const registry = createDefaultCapabilityRegistry()
  const capability = getTypedCapability<HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary>(
    registry,
    'harness'
  )
  const progressReporter = createHarnessProgressReporter()
  const ctx = createCapabilityContext({
    cwd: process.cwd(),
    configPath: options.config,
    metadata: {
      harnessProgress: progressReporter,
    },
  })
  progressReporter.start()
  const previousSessionId = process.env.MAGPIE_SESSION_ID
  if (sessionId) {
    process.env.MAGPIE_SESSION_ID = sessionId
  }
  const { output, result } = await (async () => {
    try {
      return await runCapability(capability, input, ctx)
    } finally {
      progressReporter.stop()
      if (sessionId) {
        if (previousSessionId === undefined) {
          delete process.env.MAGPIE_SESSION_ID
        } else {
          process.env.MAGPIE_SESSION_ID = previousSessionId
        }
      }
    }
  })()

  console.log(output.summary)
  if (output.details) {
    if (!progressReporter.hasAnnouncedSession()) {
      console.log(`Session: ${output.details.id}`)
      console.log(`Status: ${output.details.status}`)
      if (output.details.currentStage) {
        console.log(`Stage: ${output.details.currentStage}`)
      }
      if (output.details.artifacts.eventsPath) {
        console.log(`Events: ${output.details.artifacts.eventsPath}`)
      }
    }
    if (output.details.artifacts.workspacePath) {
      console.log(`Workspace: ${output.details.artifacts.workspacePath} (${output.details.artifacts.workspaceMode || 'current'})`)
    }
    if (output.details.artifacts.executionHost) {
      console.log(`Host: ${output.details.artifacts.executionHost}`)
    }
    if (output.details.artifacts.tmuxSession || output.details.artifacts.tmuxWindow || output.details.artifacts.tmuxPane) {
      console.log(`Tmux: session=${output.details.artifacts.tmuxSession || '-'} window=${output.details.artifacts.tmuxWindow || '-'} pane=${output.details.artifacts.tmuxPane || '-'}`)
    }
    console.log(`Config: ${output.details.artifacts.harnessConfigPath}`)
    console.log(`Rounds: ${output.details.artifacts.roundsPath}`)
    console.log(`Provider selection: ${output.details.artifacts.providerSelectionPath}`)
    console.log(`Routing: ${output.details.artifacts.routingDecisionPath}`)
    if (output.details.artifacts.loopSessionId) {
      console.log(`Loop session: ${output.details.artifacts.loopSessionId}`)
    }
  }

  if (result.status === 'failed') {
    process.exitCode = 1
  }
}

function extractHarnessResumeInput(session: WorkflowSession): {
  input: HarnessInput
  configPath?: string
} | null {
  const evidence = session.evidence as PersistedHarnessResumeEvidence | undefined
  if (!evidence?.input?.goal || !evidence.input.prdPath) {
    return null
  }

  return {
    input: evidence.input,
    ...(evidence.configPath ? { configPath: evidence.configPath } : {}),
  }
}

export const harnessCommand = new Command('harness')
  .description('Run and inspect harness workflow sessions')

harnessCommand
  .command('submit')
  .description('Start a harness workflow run')
  .argument('<goal>', 'Requirement goal')
  .requiredOption('--prd <path>', 'PRD markdown path')
  .option('-c, --config <path>', 'Path to config file')
  .option('--max-cycles <number>', 'Maximum fix/review/test cycles', (v) => Number.parseInt(v, 10))
  .option('--review-rounds <number>', 'Review debate rounds per cycle', (v) => Number.parseInt(v, 10))
  .option('--test-command <command>', 'Override unit test command used by harness')
  .option('--models <models...>', 'Model list for adversarial confirmation (overrides config defaults)')
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .option('--host <host>', 'Execution host (foreground|tmux)')
  .option('--priority <level>', 'Queue priority (interactive|high|normal|background)', parseHarnessPriority)
  .action(async (goal: string, options: HarnessCommandOptions & { prd: string }) => {
    try {
      const queuedInput: HarnessInput = {
        goal,
        prdPath: options.prd,
        maxCycles: Number.isFinite(options.maxCycles) ? options.maxCycles : undefined,
        reviewRounds: Number.isFinite(options.reviewRounds) ? options.reviewRounds : undefined,
        testCommand: options.testCommand,
        models: Array.isArray(options.models) && options.models.length > 0 ? options.models : undefined,
        complexity: options.complexity,
        host: options.host,
        priority: options.priority,
      }

      if (await isHarnessServerRunning(process.cwd())) {
        const queued = await enqueueHarnessSession(process.cwd(), queuedInput, {
          configPath: options.config,
        })
        console.log('Harness session queued.')
        console.log(`Session: ${queued.id}`)
        console.log(`Status: ${queued.status}`)
        console.log(`Priority: ${queuedInput.priority || 'normal'}`)
        if (queued.artifacts.eventsPath) {
          console.log(`Events: ${queued.artifacts.eventsPath}`)
        }
        return
      }

      if (options.host === 'tmux' && !process.env.VITEST) {
        const launch = await launchMagpieInTmux({
          capability: 'harness',
          cwd: process.cwd(),
          configPath: options.config,
          argv: [
            'harness',
            'submit',
            goal,
            '--prd',
            options.prd,
            '--host',
            'foreground',
            ...(options.config ? ['--config', options.config] : []),
            ...(Number.isFinite(options.maxCycles) ? ['--max-cycles', String(options.maxCycles)] : []),
            ...(Number.isFinite(options.reviewRounds) ? ['--review-rounds', String(options.reviewRounds)] : []),
            ...(options.testCommand ? ['--test-command', options.testCommand] : []),
            ...(Array.isArray(options.models) && options.models.length > 0 ? ['--models', ...options.models] : []),
            ...(options.complexity ? ['--complexity', options.complexity] : []),
          ],
        })

        console.log(`Session: ${launch.sessionId}`)
        console.log('Host: tmux')
        console.log(`Tmux: session=${launch.tmuxSession} window=${launch.tmuxWindow || '-'} pane=${launch.tmuxPane || '-'}`)
        return
      }

      await runHarness(queuedInput, options)
    } catch (error) {
      console.error(`harness failed: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  })

harnessCommand
  .command('status')
  .description('Show details for a persisted harness session')
  .argument('<sessionId>', 'Harness session ID')
  .action(async (sessionId: string) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (session.currentStage) {
      console.log(`Stage: ${session.currentStage}`)
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
    console.log(`Summary: ${session.summary}`)
    console.log(`Updated: ${session.updatedAt.toISOString()}`)
    if (session.artifacts.eventsPath) {
      console.log(`Events: ${session.artifacts.eventsPath}`)
    }
    await printDocumentPlanSummary(session.artifacts.documentPlanPath)
    const latestLoopActivity = await loadLatestLoopActivity(session.artifacts.loopEventsPath)
    if (latestLoopActivity) {
      if (latestLoopActivity.stage) {
        console.log(`Loop stage: ${latestLoopActivity.stage}`)
      }
      console.log(`Last activity: ${latestLoopActivity.timestamp}`)
      console.log(`Loop activity: ${latestLoopActivity.line}`)
    }
    await printKnowledgeSummary(session.artifacts)
  })

harnessCommand
  .command('resume')
  .description('Resume a persisted harness session')
  .argument('<sessionId>', 'Harness session ID')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (sessionId: string, options: Pick<HarnessCommandOptions, 'config'>) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    const persisted = extractHarnessResumeInput(session)
    if (!persisted) {
      console.error(`Harness session ${sessionId} cannot be resumed because its input metadata is missing.`)
      process.exitCode = 1
      return
    }

    await runHarnessWithSession(
      persisted.input,
      { config: options.config || persisted.configPath },
      session.id
    )
  })

harnessCommand
  .command('attach')
  .description('Print the persisted harness event stream for a session')
  .argument('<sessionId>', 'Harness session ID')
  .option('--once', 'Print current events and exit')
  .action(async (sessionId: string, options: { once?: boolean }) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (session.artifacts.workspacePath) {
      console.log(`Workspace: ${session.artifacts.workspacePath} (${session.artifacts.workspaceMode || 'current'})`)
    }
    if (session.artifacts.executionHost) {
      console.log(`Host: ${session.artifacts.executionHost}`)
    }
    if (session.artifacts.tmuxSession || session.artifacts.tmuxWindow || session.artifacts.tmuxPane) {
      console.log(`Tmux: session=${session.artifacts.tmuxSession || '-'} window=${session.artifacts.tmuxWindow || '-'} pane=${session.artifacts.tmuxPane || '-'}`)
    }
    await printKnowledgeSummary(session.artifacts)
    await followHarnessEventStream({
      sessionId,
      initialSession: session,
      loadSession: async (id) => loadWorkflowSession(process.cwd(), 'harness', id),
      once: !!options.once,
    })
  })

harnessCommand
  .command('inspect')
  .description('Show the knowledge summary for a harness session')
  .argument('<sessionId>', 'Harness session ID')
  .action(async (sessionId: string) => {
    const session = await loadWorkflowSession(process.cwd(), 'harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    await printDocumentPlanSummary(session.artifacts.documentPlanPath)
    await printKnowledgeInspectView(session.artifacts, legacyHarnessKnowledgeState(session))
  })

harnessCommand
  .command('list')
  .description('List persisted harness sessions')
  .action(async () => {
    const sessions = await listWorkflowSessions(process.cwd(), 'harness')
    if (sessions.length === 0) {
      console.log('No harness sessions found.')
      return
    }

    for (const session of sessions) {
      console.log([
        session.id,
        session.status,
        session.currentStage || '-',
        session.updatedAt.toISOString(),
        session.title,
      ].join('\t'))
    }
  })

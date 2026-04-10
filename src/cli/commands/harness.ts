import { readFile } from 'fs/promises'
import { Command } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import {
  listWorkflowSessions,
  loadWorkflowSession,
} from '../../capabilities/workflows/shared/runtime.js'
import type { HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary } from '../../capabilities/workflows/harness/types.js'

interface HarnessCommandOptions {
  config?: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
  complexity?: HarnessInput['complexity']
}

async function runHarness(input: HarnessInput, options: HarnessCommandOptions): Promise<void> {
  const registry = createDefaultCapabilityRegistry()
  const capability = getTypedCapability<HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary>(
    registry,
    'harness'
  )
  const ctx = createCapabilityContext({
    cwd: process.cwd(),
    configPath: options.config,
  })
  const { output, result } = await runCapability(capability, input, ctx)

  console.log(output.summary)
  if (output.details) {
    console.log(`Session: ${output.details.id}`)
    console.log(`Status: ${output.details.status}`)
    if (output.details.currentStage) {
      console.log(`Stage: ${output.details.currentStage}`)
    }
    console.log(`Config: ${output.details.artifacts.harnessConfigPath}`)
    console.log(`Rounds: ${output.details.artifacts.roundsPath}`)
    console.log(`Provider selection: ${output.details.artifacts.providerSelectionPath}`)
    console.log(`Routing: ${output.details.artifacts.routingDecisionPath}`)
    console.log(`Events: ${output.details.artifacts.eventsPath}`)
    if (output.details.artifacts.loopSessionId) {
      console.log(`Loop session: ${output.details.artifacts.loopSessionId}`)
    }
  }

  if (result.status === 'failed') {
    process.exitCode = 1
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
  .option('--models <models...>', 'Model list for adversarial confirmation (default: gemini-cli kiro)')
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .action(async (goal: string, options: HarnessCommandOptions & { prd: string }) => {
    try {
      await runHarness({
        goal,
        prdPath: options.prd,
        maxCycles: Number.isFinite(options.maxCycles) ? options.maxCycles : undefined,
        reviewRounds: Number.isFinite(options.reviewRounds) ? options.reviewRounds : undefined,
        testCommand: options.testCommand,
        models: Array.isArray(options.models) && options.models.length > 0 ? options.models : undefined,
        complexity: options.complexity,
      }, options)
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
    const session = await loadWorkflowSession('harness', sessionId)
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
    console.log(`Summary: ${session.summary}`)
    console.log(`Updated: ${session.updatedAt.toISOString()}`)
    if (session.artifacts.eventsPath) {
      console.log(`Events: ${session.artifacts.eventsPath}`)
    }
  })

harnessCommand
  .command('attach')
  .description('Print the persisted harness event stream for a session')
  .argument('<sessionId>', 'Harness session ID')
  .action(async (sessionId: string) => {
    const session = await loadWorkflowSession('harness', sessionId)
    if (!session) {
      console.error(`Harness session not found: ${sessionId}`)
      process.exitCode = 1
      return
    }

    console.log(`Session: ${session.id}`)
    console.log(`Status: ${session.status}`)
    if (!session.artifacts.eventsPath) {
      console.log('No persisted event stream for this session.')
      return
    }

    const raw = await readFile(session.artifacts.eventsPath, 'utf-8').catch(() => '')
    const lines = raw.trim()
      ? raw.trim().split('\n').flatMap((line) => {
          try {
            return [JSON.parse(line) as {
              timestamp?: string
              type: string
              stage?: string
              cycle?: number
              summary?: string
            }]
          } catch {
            return []
          }
        })
      : []

    if (lines.length === 0) {
      console.log('No persisted event stream for this session.')
      return
    }

    for (const event of lines) {
      const cycle = Number.isFinite(event.cycle) ? ` cycle=${event.cycle}` : ''
      const stage = event.stage ? ` stage=${event.stage}` : ''
      const summary = event.summary ? ` ${event.summary}` : ''
      console.log(`${event.timestamp || ''} ${event.type}${stage}${cycle}${summary}`.trim())
    }
  })

harnessCommand
  .command('list')
  .description('List persisted harness sessions')
  .action(async () => {
    const sessions = await listWorkflowSessions('harness')
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

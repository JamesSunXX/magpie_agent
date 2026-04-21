import { Command } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import { createHarnessProgressReporter } from './harness-progress.js'
import type { DocsSyncInput, DocsSyncPreparedInput, DocsSyncResult, DocsSyncSummary } from '../../capabilities/workflows/docs-sync/types.js'
import type { HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary } from '../../capabilities/workflows/harness/types.js'
import type { IssueFixInput, IssueFixPreparedInput, IssueFixResult, IssueFixSummary } from '../../capabilities/workflows/issue-fix/types.js'
import type {
  PostMergeRegressionInput,
  PostMergeRegressionPreparedInput,
  PostMergeRegressionResult,
  PostMergeRegressionSummary,
} from '../../capabilities/workflows/post-merge-regression/types.js'
import type { ExecutionHost } from '../../platform/integrations/operations/types.js'
import { launchMagpieInTmux } from './tmux-launch.js'

const workflowCommand = new Command('workflow')
  .description('AI-native engineering workflows')

workflowCommand
  .command('issue-fix')
  .description('Plan and execute an issue triage/fix workflow')
  .argument('<issue>', 'Issue summary or bug report')
  .option('-c, --config <path>', 'Path to config file')
  .option('--apply', 'Allow executor agent to apply changes', false)
  .option('--verify-command <command>', 'Override verification command')
  .option('--planning-item <key>', 'Override planning item key for remote context lookup')
  .option('--planning-project <key>', 'Override planning project key for remote context lookup')
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .action(async (issue: string, options) => {
    try {
      const registry = createDefaultCapabilityRegistry({ configPath: options.config })
      const capability = getTypedCapability<IssueFixInput, IssueFixPreparedInput, IssueFixResult, IssueFixSummary>(
        registry,
        'issue-fix'
      )
      const ctx = createCapabilityContext({ cwd: process.cwd(), configPath: options.config })
      const { output } = await runCapability(capability, {
        issue,
        apply: options.apply,
        verifyCommand: options.verifyCommand,
        planningItemKey: options.planningItem,
        planningProjectKey: options.planningProject,
        complexity: options.complexity,
      }, ctx)

      console.log(output.summary)
      if (output.details) {
        console.log(`Session: ${output.details.id}`)
        console.log(`Plan: ${output.details.artifacts.planPath}`)
        console.log(`Execution: ${output.details.artifacts.executionPath}`)
        if (output.details.artifacts.routingDecisionPath) {
          console.log(`Routing: ${output.details.artifacts.routingDecisionPath}`)
        }
      }
    } catch (error) {
      console.error('issue-fix failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  })

workflowCommand
  .command('docs-sync')
  .description('Review repo docs against current code and produce an update brief')
  .option('-c, --config <path>', 'Path to config file')
  .option('--apply', 'Allow executor agent to update docs', false)
  .action(async (options) => {
    const registry = createDefaultCapabilityRegistry({ configPath: options.config })
    const capability = getTypedCapability<DocsSyncInput, DocsSyncPreparedInput, DocsSyncResult, DocsSyncSummary>(
      registry,
      'docs-sync'
    )
    const ctx = createCapabilityContext({ cwd: process.cwd(), configPath: options.config })
    const { output } = await runCapability(capability, { apply: options.apply }, ctx)

    console.log(output.summary)
    if (output.details) {
      console.log(`Session: ${output.details.id}`)
      console.log(`Report: ${output.details.artifacts.reportPath}`)
    }
  })

workflowCommand
  .command('harness')
  .description('Run harness-mode requirement delivery with adversarial model self-confirmation')
  .argument('<goal>', 'Requirement goal')
  .requiredOption('--prd <path>', 'PRD markdown path')
  .option('-c, --config <path>', 'Path to config file')
  .option('--max-cycles <number>', 'Maximum fix/review/test cycles', (v) => Number.parseInt(v, 10))
  .option('--review-rounds <number>', 'Review debate rounds per cycle', (v) => Number.parseInt(v, 10))
  .option('--test-command <command>', 'Override unit test command used by harness')
  .option('--models <models...>', 'Model list for adversarial confirmation (default: gemini-cli kiro)')
  .option('--complexity <tier>', 'Override routing complexity (simple|standard|complex)')
  .option('--host <host>', 'Execution host (foreground|tmux)')
  .action(async (goal: string, options) => {
    try {
      if (options.host === 'tmux' && !process.env.VITEST) {
        const launch = await launchMagpieInTmux({
          capability: 'harness',
          cwd: process.cwd(),
          configPath: options.config,
          argv: [
            'workflow',
            'harness',
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

      const registry = createDefaultCapabilityRegistry({ configPath: options.config })
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
      const { output, result } = await (async () => {
        try {
          return await runCapability(capability, {
            goal,
            prdPath: options.prd,
            maxCycles: Number.isFinite(options.maxCycles) ? options.maxCycles : undefined,
            reviewRounds: Number.isFinite(options.reviewRounds) ? options.reviewRounds : undefined,
            testCommand: options.testCommand,
            models: Array.isArray(options.models) && options.models.length > 0 ? options.models : undefined,
            complexity: options.complexity,
            host: options.host as ExecutionHost | undefined,
          }, ctx)
        } finally {
          progressReporter.stop()
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
        console.error(`Harness failed: ${output.summary}`)
        process.exitCode = 1
      }
    } catch (error) {
      console.error(`harness failed: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  })

workflowCommand
  .command('post-merge-regression')
  .description('Run post-merge regression checks and summarize the results')
  .option('-c, --config <path>', 'Path to config file')
  .option('--command <command...>', 'Override regression commands')
  .action(async (options) => {
    const registry = createDefaultCapabilityRegistry({ configPath: options.config })
    const capability = getTypedCapability<
      PostMergeRegressionInput,
      PostMergeRegressionPreparedInput,
      PostMergeRegressionResult,
      PostMergeRegressionSummary
    >(registry, 'post-merge-regression')
    const ctx = createCapabilityContext({ cwd: process.cwd(), configPath: options.config })
    const { output } = await runCapability(capability, { commands: options.command }, ctx)

    console.log(output.summary)
    if (output.details) {
      console.log(`Session: ${output.details.id}`)
      console.log(`Report: ${output.details.artifacts.reportPath}`)
    }
  })

export { workflowCommand }

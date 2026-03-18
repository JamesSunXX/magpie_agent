import { Command } from 'commander'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type { DocsSyncInput, DocsSyncPreparedInput, DocsSyncResult, DocsSyncSummary } from '../../capabilities/workflows/docs-sync/types.js'
import type { IssueFixInput, IssueFixPreparedInput, IssueFixResult, IssueFixSummary } from '../../capabilities/workflows/issue-fix/types.js'
import type {
  PostMergeRegressionInput,
  PostMergeRegressionPreparedInput,
  PostMergeRegressionResult,
  PostMergeRegressionSummary,
} from '../../capabilities/workflows/post-merge-regression/types.js'

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
  .action(async (issue: string, options) => {
    try {
      const registry = createDefaultCapabilityRegistry()
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
      }, ctx)

      console.log(output.summary)
      if (output.details) {
        console.log(`Session: ${output.details.id}`)
        console.log(`Plan: ${output.details.artifacts.planPath}`)
        console.log(`Execution: ${output.details.artifacts.executionPath}`)
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
    const registry = createDefaultCapabilityRegistry()
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
  .command('post-merge-regression')
  .description('Run post-merge regression checks and summarize the results')
  .option('-c, --config <path>', 'Path to config file')
  .option('--command <command...>', 'Override regression commands')
  .action(async (options) => {
    const registry = createDefaultCapabilityRegistry()
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

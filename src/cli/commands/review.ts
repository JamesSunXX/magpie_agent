import { Command } from 'commander'
import chalk from 'chalk'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  ReviewCapabilityInput,
  ReviewCommandOptions,
  ReviewExecutionResult,
  ReviewPreparedInput,
  ReviewSummaryOutput,
} from '../../capabilities/review/types.js'

export const reviewCommand = new Command('review')
  .description('Review code changes with multiple AI reviewers')
  .argument('[pr]', 'PR number or URL (optional if using --local, --branch, --files, or --repo)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-r, --rounds <number>', 'Maximum debate rounds', '5')
  .option('-i, --interactive', 'Interactive mode (pause between turns)')
  .option('-o, --output <file>', 'Output to file instead of stdout')
  .option('-f, --format <format>', 'Output format (markdown|json)', 'markdown')
  .option('--no-converge', 'Disable early stop when reviewers reach consensus')
  .option('-l, --local', 'Review local uncommitted changes (staged + unstaged)')
  .option('-b, --branch [base]', 'Review current branch vs base (default: main)')
  .option('--files <files...>', 'Review specific files')
  .option('--commit <sha>', 'Review a specific commit')
  .option('--git-remote <name>', 'Git remote to use for PR URL detection (default: origin)')
  .option('--reviewers <ids>', 'Comma-separated reviewer IDs to use (e.g., claude,gemini)')
  .option('-a, --all', 'Use all reviewers (skip selection)')
  .option('--repo', 'Review entire repository')
  .option('--path <path>', 'Subdirectory to review (with --repo)')
  .option('--ignore <patterns...>', 'Patterns to ignore (with --repo)')
  .option('--quick', 'Quick mode: only architecture overview')
  .option('--deep', 'Deep mode: full analysis without prompts')
  .option('--plan-only', 'Only generate review plan, do not execute')
  .option('--reanalyze', 'Force re-analyze features (ignore cache)')
  .option('--list-sessions', 'List all review sessions')
  .option('--session <id>', 'Resume specific session by ID')
  .option('--export <file>', 'Export completed review to markdown')
  .option('--skip-context', 'Skip context gathering phase')
  .option('--no-post', 'Skip post-processing (GitHub comment flow)')
  .action(async (pr: string | undefined, options: ReviewCommandOptions) => {
    const registry = createDefaultCapabilityRegistry()
    const capability = getTypedCapability<
      ReviewCapabilityInput,
      ReviewPreparedInput,
      ReviewExecutionResult,
      ReviewSummaryOutput
    >(registry, 'review')

    const ctx = createCapabilityContext({
      cwd: process.cwd(),
      configPath: options.config,
      metadata: {
        format: options.format,
      },
    })

    try {
      const { result } = await runCapability(capability, {
        target: pr,
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

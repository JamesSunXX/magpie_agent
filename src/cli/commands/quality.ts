import { Command } from 'commander'
import { runCapability } from '../../core/capability/runner.js'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  UnitTestEvalInput,
  UnitTestEvalPrepared,
  UnitTestEvalResult,
  UnitTestEvalSummary,
} from '../../capabilities/quality/unit-test-eval/types.js'

const qualityCommand = new Command('quality')
  .description('Quality-related capabilities')

const unitTestEvalCommand = new Command('unit-test-eval')
  .description('Evaluate unit-test quality for generated or existing code')
  .argument('[path]', 'Project path to evaluate (default: current working directory)')
  .option('-c, --config <path>', 'Path to config file')
  .option('--max-files <number>', 'Maximum number of source files to inspect', (v) => Number.parseInt(v, 10))
  .option('--min-coverage <number>', 'Minimum target coverage, range 0..1', (v) => Number.parseFloat(v))
  .option('-f, --format <format>', 'Output format (markdown|json)', 'markdown')
  .option('--run-tests', 'Run test command as part of evaluation')
  .option('--test-command <command>', 'Test command to execute when --run-tests is set', 'npm run test:run')
  .action(async (path: string | undefined, options) => {
    const registry = createDefaultCapabilityRegistry({ configPath: options.config })
    const capability = getTypedCapability<UnitTestEvalInput, UnitTestEvalPrepared, UnitTestEvalResult, UnitTestEvalSummary>(
      registry,
      'quality/unit-test-eval'
    )

    const ctx = createCapabilityContext({
      cwd: path || process.cwd(),
      configPath: options.config,
      metadata: {
        format: options.format,
      },
    })

    const input: UnitTestEvalInput = {
      path,
      maxFiles: Number.isFinite(options.maxFiles) ? options.maxFiles : undefined,
      minCoverage: Number.isFinite(options.minCoverage) ? options.minCoverage : undefined,
      format: options.format,
      runTests: options.runTests,
      testCommand: options.testCommand,
    }

    try {
      await runCapability(capability, input, ctx)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  })

qualityCommand.addCommand(unitTestEvalCommand)

export { qualityCommand }

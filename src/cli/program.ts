import { Command, CommanderError } from 'commander'
import { isRuntimeCapabilityEnabled, type RuntimeCapabilityId } from '../capabilities/routing/index.js'
import { getConfigVersionStatus, loadConfig } from '../platform/config/loader.js'
import { discussCommand } from './commands/discuss.js'
import { doctorCommand } from './commands/doctor.js'
import { harnessCommand } from './commands/harness.js'
import { harnessServerCommand } from './commands/harness-server.js'
import { imServerCommand } from './commands/im-server.js'
import { initCommand } from './commands/init.js'
import { loopCommand } from './commands/loop.js'
import { memoryCommand } from './commands/memory.js'
import { qualityCommand } from './commands/quality.js'
import { reviewCommand } from './commands/review.js'
import { reviewersCommand } from './commands/reviewers.js'
import { skillsCommand } from './commands/skills.js'
import { statsCommand } from './commands/stats.js'
import { statusCommand } from './commands/status.js'
import { tuiCommand } from './commands/tui.js'
import { trdCommand } from './commands/trd.js'
import { workflowCommand } from './commands/workflow.js'

interface CapabilityGateDefinition {
  capabilityId: RuntimeCapabilityId
  configPath: string
  alternative: string
}

const CAPABILITY_GATES: Record<
  Exclude<RuntimeCapabilityId, 'stats'>,
  CapabilityGateDefinition
> = {
  review: {
    capabilityId: 'review',
    configPath: 'capabilities.review.enabled',
    alternative: 'Use `magpie discuss "<topic>"` to continue with a discussion workflow.',
  },
  discuss: {
    capabilityId: 'discuss',
    configPath: 'capabilities.discuss.enabled',
    alternative: 'Use `magpie review --local` for code-focused analysis.',
  },
  trd: {
    capabilityId: 'trd',
    configPath: 'capabilities.trd.enabled',
    alternative: 'Use `magpie discuss "<topic>"` to refine requirements before generating TRD.',
  },
  loop: {
    capabilityId: 'loop',
    configPath: 'capabilities.loop.enabled',
    alternative: 'Use `magpie workflow issue-fix "<issue>"` for a narrower execution flow.',
  },
  harness: {
    capabilityId: 'harness',
    configPath: 'capabilities.harness.enabled',
    alternative: 'Use `magpie loop run "<goal>" --prd <path>` for single-track delivery.',
  },
  'issue-fix': {
    capabilityId: 'issue-fix',
    configPath: 'capabilities.issue_fix.enabled',
    alternative: 'Use `magpie review --local` for manual diagnosis and patch planning.',
  },
  'docs-sync': {
    capabilityId: 'docs-sync',
    configPath: 'capabilities.docs_sync.enabled',
    alternative: 'Use `magpie review --repo` to inspect documentation drift manually.',
  },
  'post-merge-regression': {
    capabilityId: 'post-merge-regression',
    configPath: 'capabilities.post_merge_regression.enabled',
    alternative: 'Use `magpie quality unit-test-eval . --run-tests` for baseline verification.',
  },
  'quality/unit-test-eval': {
    capabilityId: 'quality/unit-test-eval',
    configPath: 'capabilities.quality.unitTestEval.enabled',
    alternative: 'Use `magpie stats` for lightweight trend checks.',
  },
}

function extractConfigPath(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config' || arg === '-c') {
      return argv[index + 1]
    }
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length)
    }
  }
  return undefined
}

function extractCommandPath(actionCommand: Command): string[] {
  const names: string[] = []
  let current: Command | undefined = actionCommand

  while (current && current.parent) {
    names.unshift(current.name())
    current = current.parent || undefined
  }

  return names
}

function resolveCapabilityGate(actionCommand: Command): CapabilityGateDefinition | null {
  const [primary, secondary] = extractCommandPath(actionCommand)

  if (!primary) return null

  if (primary === 'review') return CAPABILITY_GATES.review
  if (primary === 'discuss') return CAPABILITY_GATES.discuss
  if (primary === 'trd') return CAPABILITY_GATES.trd
  if (primary === 'loop') return CAPABILITY_GATES.loop
  if (primary === 'harness') return CAPABILITY_GATES.harness

  if (primary === 'workflow' && secondary) {
    if (secondary === 'issue-fix') return CAPABILITY_GATES['issue-fix']
    if (secondary === 'docs-sync') return CAPABILITY_GATES['docs-sync']
    if (secondary === 'harness') return CAPABILITY_GATES.harness
    if (secondary === 'post-merge-regression') return CAPABILITY_GATES['post-merge-regression']
  }

  if (primary === 'quality' && secondary === 'unit-test-eval') {
    return CAPABILITY_GATES['quality/unit-test-eval']
  }

  return null
}

function formatCapabilityDisabledMessage(definition: CapabilityGateDefinition): string {
  return [
    `Capability "${definition.capabilityId}" is currently disabled.`,
    `Enable it by setting \`${definition.configPath}: true\` in your config file.`,
    definition.alternative,
  ].join('\n')
}

export function createProgram(): Command {
  const program = new Command()

  program
    .name('magpie')
    .description('Multi-AI adversarial PR review tool')
    .version('0.1.0')

  program.hook('preAction', (_, actionCommand) => {
    if (actionCommand.name() === 'init' || actionCommand.name() === 'doctor') {
      return
    }

    const commandArgs = Array.isArray((actionCommand as Command & { rawArgs?: string[] }).rawArgs)
      ? (actionCommand as Command & { rawArgs?: string[] }).rawArgs || []
      : []
    const configPath = extractConfigPath(commandArgs) || extractConfigPath(process.argv)

    const gate = resolveCapabilityGate(actionCommand)
    if (gate) {
      let config = null
      try {
        config = loadConfig(configPath)
      } catch {
        // Keep preAction non-blocking on config load errors so the command can
        // surface the existing detailed validation error in its own flow.
      }

      if (config && !isRuntimeCapabilityEnabled(config, gate.capabilityId)) {
        throw new CommanderError(
          1,
          'magpie.capabilityDisabled',
          formatCapabilityDisabledMessage(gate)
        )
      }
    }

    const status = getConfigVersionStatus(configPath)
    if (status.state !== 'current' && status.message) {
      console.warn(`\n! ${status.message}`)
    }
  })

  program.addCommand(reviewCommand)
  program.addCommand(reviewersCommand)
  program.addCommand(initCommand)
  program.addCommand(doctorCommand)
  program.addCommand(memoryCommand)
  program.addCommand(discussCommand)
  program.addCommand(harnessCommand)
  program.addCommand(harnessServerCommand)
  program.addCommand(imServerCommand)
  program.addCommand(trdCommand)
  program.addCommand(qualityCommand)
  program.addCommand(loopCommand)
  program.addCommand(workflowCommand)
  program.addCommand(statusCommand)
  program.addCommand(skillsCommand)
  program.addCommand(statsCommand)
  program.addCommand(tuiCommand)

  return program
}

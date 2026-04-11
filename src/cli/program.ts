import { Command } from 'commander'
import { getConfigVersionStatus } from '../platform/config/loader.js'
import { discussCommand } from './commands/discuss.js'
import { harnessCommand } from './commands/harness.js'
import { initCommand } from './commands/init.js'
import { loopCommand } from './commands/loop.js'
import { qualityCommand } from './commands/quality.js'
import { reviewCommand } from './commands/review.js'
import { reviewersCommand } from './commands/reviewers.js'
import { statsCommand } from './commands/stats.js'
import { tuiCommand } from './commands/tui.js'
import { trdCommand } from './commands/trd.js'
import { workflowCommand } from './commands/workflow.js'

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

export function createProgram(): Command {
  const program = new Command()

  program
    .name('magpie')
    .description('Multi-AI adversarial PR review tool')
    .version('0.1.0')

  program.hook('preAction', (_, actionCommand) => {
    if (actionCommand.name() === 'init') {
      return
    }

    const commandArgs = Array.isArray((actionCommand as Command & { rawArgs?: string[] }).rawArgs)
      ? (actionCommand as Command & { rawArgs?: string[] }).rawArgs || []
      : []
    const configPath = extractConfigPath(commandArgs) || extractConfigPath(process.argv)
    const status = getConfigVersionStatus(configPath)
    if (status.state !== 'current' && status.message) {
      console.warn(`\n! ${status.message}`)
    }
  })

  program.addCommand(reviewCommand)
  program.addCommand(reviewersCommand)
  program.addCommand(initCommand)
  program.addCommand(discussCommand)
  program.addCommand(harnessCommand)
  program.addCommand(trdCommand)
  program.addCommand(qualityCommand)
  program.addCommand(loopCommand)
  program.addCommand(workflowCommand)
  program.addCommand(statsCommand)
  program.addCommand(tuiCommand)

  return program
}

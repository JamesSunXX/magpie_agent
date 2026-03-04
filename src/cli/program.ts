import { Command } from 'commander'
import { discussCommand } from './commands/discuss.js'
import { initCommand } from './commands/init.js'
import { qualityCommand } from './commands/quality.js'
import { reviewCommand } from './commands/review.js'
import { statsCommand } from './commands/stats.js'
import { trdCommand } from './commands/trd.js'

export function createProgram(): Command {
  const program = new Command()

  program
    .name('magpie')
    .description('Multi-AI adversarial PR review tool')
    .version('0.1.0')

  program.addCommand(reviewCommand)
  program.addCommand(initCommand)
  program.addCommand(discussCommand)
  program.addCommand(trdCommand)
  program.addCommand(qualityCommand)
  program.addCommand(statsCommand)

  return program
}

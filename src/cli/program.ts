import { Command } from 'commander'
import { discussCommand } from './commands/discuss.js'
import { initCommand } from './commands/init.js'
import { loopCommand } from './commands/loop.js'
import { qualityCommand } from './commands/quality.js'
import { reviewCommand } from './commands/review.js'
import { reviewersCommand } from './commands/reviewers.js'
import { statsCommand } from './commands/stats.js'
import { trdCommand } from './commands/trd.js'
import { workflowCommand } from './commands/workflow.js'

export function createProgram(): Command {
  const program = new Command()

  program
    .name('magpie')
    .description('Multi-AI adversarial PR review tool')
    .version('0.1.0')

  program.addCommand(reviewCommand)
  program.addCommand(reviewersCommand)
  program.addCommand(initCommand)
  program.addCommand(discussCommand)
  program.addCommand(trdCommand)
  program.addCommand(qualityCommand)
  program.addCommand(loopCommand)
  program.addCommand(workflowCommand)
  program.addCommand(statsCommand)

  return program
}

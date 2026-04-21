import { Command } from 'commander'
import chalk from 'chalk'
import { runDoctorChecks, type DoctorCheckResult } from '../../capabilities/stats/application/doctor.js'

interface DoctorCommandOptions {
  config?: string
}

function renderCheck(check: DoctorCheckResult): string {
  if (check.status === 'pass') {
    return chalk.green(`✓ ${check.title}: ${check.message}`)
  }
  if (check.status === 'warn') {
    return chalk.yellow(`! ${check.title}: ${check.message}`)
  }
  return chalk.red(`✗ ${check.title}: ${check.message}`)
}

export const doctorCommand = new Command('doctor')
  .description('Check local Magpie setup and provide actionable fixes')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: DoctorCommandOptions) => {
    try {
      const result = runDoctorChecks({
        cwd: process.cwd(),
        configPath: options.config,
      })

      console.log(chalk.cyan('Magpie doctor'))
      console.log(chalk.dim(`Config: ${result.configPath}`))

      result.checks.forEach(check => {
        console.log(renderCheck(check))
        if (check.fixCommand) {
          console.log(chalk.white(`  Fix: ${check.fixCommand}`))
        }
      })

      console.log(chalk.cyan(
        `Doctor summary: ${result.summary.pass} passed, ${result.summary.warn} warnings, ${result.summary.fail} failed.`
      ))
      console.log(chalk.cyan(`Ready: ${result.readiness.headline}`))
      result.readiness.nextSteps.forEach(step => {
        console.log(chalk.white(`  Next: ${step}`))
      })

      if (result.summary.fail > 0) {
        console.error(chalk.red('Doctor found blocking issues.'))
        process.exitCode = 1
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      process.exitCode = 1
    }
  })

import chalk from 'chalk'
import type { UnitTestEvalSummary } from '../types.js'

export function renderUnitTestEvalSummary(summary: UnitTestEvalSummary): string {
  if (summary.format === 'json') {
    return JSON.stringify(summary.json, null, 2)
  }
  return summary.text
}

export function printUnitTestEvalSummary(summary: UnitTestEvalSummary): void {
  if (summary.format === 'json') {
    console.log(renderUnitTestEvalSummary(summary))
    return
  }

  console.log(chalk.cyan('\nUnit Test Evaluation'))
  console.log(renderUnitTestEvalSummary(summary))
}

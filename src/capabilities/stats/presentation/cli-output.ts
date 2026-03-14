import chalk from 'chalk'
import type { StatsSummary } from '../types.js'

export function renderStatsSummary(summary: StatsSummary): string {
  if (summary.format === 'json') {
    return JSON.stringify(summary.json, null, 2)
  }

  return summary.text
}

export function printStatsSummary(summary: StatsSummary): void {
  if (summary.format === 'json') {
    console.log(renderStatsSummary(summary))
    return
  }

  console.log(chalk.cyan('\nReview Stats'))
  console.log(renderStatsSummary(summary))
}

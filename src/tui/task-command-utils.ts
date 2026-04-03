import type { TaskValue, TaskValues } from './types.js'

export function shellQuote(value: string): string {
  if (!/[^\w./:-]/.test(value)) {
    return value
  }

  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

export function buildCommandDisplay(argv: string[]): string {
  return ['magpie', ...argv].map(shellQuote).join(' ')
}

export function maybePushBoolean(argv: string[], flag: string, value: TaskValue): void {
  if (value === true) {
    argv.push(flag)
  }
}

export function maybePushText(argv: string[], flag: string, value: TaskValue): void {
  if (typeof value === 'string' && value.trim()) {
    argv.push(flag, value.trim())
  }
}

export function maybePushDelimitedValues(argv: string[], flag: string, value: TaskValue): void {
  if (typeof value !== 'string') {
    return
  }

  const entries = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (entries.length > 0) {
    argv.push(flag, ...entries)
  }
}

export function appendReviewOptions(argv: string[], values: TaskValues): void {
  const hasExplicitReviewers = typeof values.reviewers === 'string' && values.reviewers.trim().length > 0
  const useAllReviewers = values.all === true

  if (!hasExplicitReviewers && !useAllReviewers) {
    argv.push('--all')
  }

  maybePushText(argv, '--reviewers', values.reviewers)
  maybePushBoolean(argv, '--all', values.all)
  maybePushBoolean(argv, '--quick', values.quick)
  maybePushBoolean(argv, '--deep', values.deep)

  if (values.format === 'json') {
    argv.push('--format', 'json')
  }

  maybePushText(argv, '--output', values.output)
}

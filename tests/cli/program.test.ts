import { describe, expect, it } from 'vitest'
import { createProgram } from '../../src/cli/program.js'

describe('CLI program', () => {
  it('registers reviewers command with list subcommand', () => {
    const program = createProgram()
    const reviewers = program.commands.find((command) => command.name() === 'reviewers')

    expect(reviewers).toBeTruthy()
    expect(reviewers?.commands.some((subcommand) => subcommand.name() === 'list')).toBe(true)
  })

  it('registers workflow command with issue-fix, docs-sync, and post-merge-regression subcommands', () => {
    const program = createProgram()
    const workflow = program.commands.find((command) => command.name() === 'workflow')

    expect(workflow).toBeTruthy()
    expect(workflow?.commands.map((subcommand) => subcommand.name())).toEqual([
      'issue-fix',
      'docs-sync',
      'post-merge-regression',
    ])
  })

  it('registers stats as a top-level command', () => {
    const program = createProgram()
    const stats = program.commands.find((command) => command.name() === 'stats')

    expect(stats).toBeTruthy()
  })
})

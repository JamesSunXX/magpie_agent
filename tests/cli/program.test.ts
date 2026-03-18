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

  it('documents repo review as a valid mode without a PR argument', () => {
    const program = createProgram()
    const review = program.commands.find((command) => command.name() === 'review')
    const help = review?.helpInformation().replace(/\s+/g, ' ')

    expect(help).toContain(
      'PR number or URL (optional if using --local, --branch, --files, or --repo)'
    )
  })

  it('registers explicit planning target options for loop run and workflow issue-fix', () => {
    const program = createProgram()
    const loop = program.commands.find((command) => command.name() === 'loop')
    const workflow = program.commands.find((command) => command.name() === 'workflow')
    const loopRun = loop?.commands.find((subcommand) => subcommand.name() === 'run')
    const issueFix = workflow?.commands.find((subcommand) => subcommand.name() === 'issue-fix')

    const loopOptionFlags = loopRun?.options.map((option) => option.long) || []
    const issueFixOptionFlags = issueFix?.options.map((option) => option.long) || []

    expect(loopOptionFlags).toContain('--planning-item')
    expect(loopOptionFlags).toContain('--planning-project')
    expect(issueFixOptionFlags).toContain('--planning-item')
    expect(issueFixOptionFlags).toContain('--planning-project')
  })
})

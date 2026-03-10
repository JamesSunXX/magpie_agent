import { describe, expect, it } from 'vitest'
import { createProgram } from '../../src/cli/program.js'

describe('CLI program', () => {
  it('registers reviewers command with list subcommand', () => {
    const program = createProgram()
    const reviewers = program.commands.find((command) => command.name() === 'reviewers')

    expect(reviewers).toBeTruthy()
    expect(reviewers?.commands.some((subcommand) => subcommand.name() === 'list')).toBe(true)
  })
})

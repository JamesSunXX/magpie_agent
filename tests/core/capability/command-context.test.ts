import { describe, expect, it } from 'vitest'
import {
  CommandExitError,
  commandExit,
  runInCommandContext,
} from '../../../src/core/capability/command-context.js'

describe('command context', () => {
  it('throws CommandExitError with the requested code', () => {
    expect(() => commandExit(7)).toThrow(CommandExitError)
    expect(() => commandExit(7)).toThrow(/code 7/)
  })

  it('restores cwd after running in a temporary command context', async () => {
    const original = process.cwd()

    await runInCommandContext('/', async () => {
      expect(process.cwd()).toBe('/')
    })

    expect(process.cwd()).toBe(original)
  })
})

import { describe, expect, it } from 'vitest'
import { resolveContextProvider } from '../../../src/capabilities/review/runtime/flow.js'

describe('review runtime context selection', () => {
  it('prefers the provider tool over the concrete model id', () => {
    expect(resolveContextProvider('codex', 'gpt-5.4')).toBe('codex')
    expect(resolveContextProvider('claude-code', 'claude-sonnet-4-6')).toBe('claude-code')
    expect(resolveContextProvider('gemini', 'gemini-2.5-pro')).toBe('gemini-cli')
    expect(resolveContextProvider('claude', 'claude-sonnet-4-6')).toBe('claude-code')
  })
})

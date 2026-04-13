import { describe, expect, it } from 'vitest'
import {
  resolveContextProvider,
  resolveReviewerSupportBinding,
} from '../../../src/capabilities/review/runtime/flow.js'

describe('review runtime context selection', () => {
  it('prefers the provider tool over the concrete model id', () => {
    expect(resolveContextProvider('codex', 'gpt-5.4')).toBe('codex')
    expect(resolveContextProvider('claude-code', 'claude-sonnet-4-6')).toBe('claude-code')
    expect(resolveContextProvider('gemini', 'gemini-2.5-pro')).toBe('gemini-cli')
    expect(resolveContextProvider('claude', 'claude-sonnet-4-6')).toBe('claude-code')
  })

  it('uses the solo reviewer binding as a whole for support roles', () => {
    expect(resolveReviewerSupportBinding(
      { tool: 'codex', model: 'gpt-5.4' },
      { model: 'kiro', agent: 'architect' }
    )).toEqual({
      tool: undefined,
      model: 'kiro',
      agent: 'architect',
    })

    expect(resolveReviewerSupportBinding(
      { model: 'kiro', agent: 'architect' },
      { tool: 'codex' }
    )).toEqual({
      tool: 'codex',
      model: undefined,
      agent: undefined,
    })
  })

  it('keeps the base binding when there is no solo reviewer override', () => {
    expect(resolveReviewerSupportBinding({
      tool: 'codex',
      model: 'gpt-5.4',
      agent: undefined,
    })).toEqual({
      tool: 'codex',
      model: 'gpt-5.4',
      agent: undefined,
    })
  })
})

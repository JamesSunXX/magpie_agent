import { describe, expect, it } from 'vitest'
import { resolveProviderBinding } from '../../src/providers/configured-provider.js'

describe('resolveProviderBinding', () => {
  it('prefers explicit kiro agent from config', () => {
    expect(resolveProviderBinding({
      logicalName: 'reviewers.go-review',
      model: 'kiro',
      agent: 'go-reviewer',
    })).toEqual({
      logicalName: 'reviewers.go-review',
      model: 'kiro',
      agent: 'go-reviewer',
    })
  })

  it('falls back to same-name matching for kiro when agent is omitted', () => {
    expect(resolveProviderBinding({
      logicalName: 'reviewers.frontend-reviewer',
      model: 'kiro',
    })).toEqual({
      logicalName: 'reviewers.frontend-reviewer',
      model: 'kiro',
      agent: 'frontend-reviewer',
    })
  })

  it('maps kiro planner and executor bindings to built-in agents', () => {
    expect(resolveProviderBinding({
      logicalName: 'capabilities.loop.planner',
      model: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.planner',
      model: 'kiro',
      agent: 'kiro_planner',
    })

    expect(resolveProviderBinding({
      logicalName: 'capabilities.loop.executor',
      model: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.executor',
      model: 'kiro',
      agent: 'dev',
    })
  })

  it('does not carry agent metadata for non-kiro models', () => {
    expect(resolveProviderBinding({
      logicalName: 'analyzer',
      model: 'codex',
      agent: 'architect',
    })).toEqual({
      logicalName: 'analyzer',
      model: 'codex',
    })
  })
})

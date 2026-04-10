import { describe, expect, it } from 'vitest'
import { resolveProviderBinding } from '../../src/providers/configured-provider.js'

describe('resolveProviderBinding', () => {
  it('keeps explicit tool, model, and kiro agent metadata', () => {
    expect(resolveProviderBinding({
      logicalName: 'reviewers.route-architect',
      tool: 'kiro',
      model: 'claude-sonnet-4-6',
      agent: 'architect',
    })).toEqual({
      logicalName: 'reviewers.route-architect',
      tool: 'kiro',
      model: 'claude-sonnet-4-6',
      agent: 'architect',
    })
  })

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

  it('rejects agent metadata for non-kiro bindings', () => {
    expect(() => resolveProviderBinding({
      logicalName: 'analyzer',
      tool: 'codex',
      model: 'gpt-5.4',
      agent: 'architect',
    })).toThrow('Only kiro bindings may define an agent')
  })
})

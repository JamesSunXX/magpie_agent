import { describe, expect, it } from 'vitest'
import { resolveAutoBranchProviderBinding } from '../../../src/capabilities/loop/domain/auto-branch-provider-binding.js'

describe('resolveAutoBranchProviderBinding', () => {
  it('defaults to the claw tool when no override is configured', () => {
    expect(resolveAutoBranchProviderBinding({})).toEqual({
      logicalName: 'capabilities.loop.auto_branch',
      tool: 'claw',
    })
  })

  it('keeps a usable dev agent for kiro bindings', () => {
    expect(resolveAutoBranchProviderBinding({
      tool: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_branch',
      tool: 'kiro',
      agent: 'dev',
    })
  })
})

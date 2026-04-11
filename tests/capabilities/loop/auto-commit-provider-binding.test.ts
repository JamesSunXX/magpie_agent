import { describe, expect, it } from 'vitest'
import { resolveAutoCommitProviderBinding } from '../../../src/capabilities/loop/domain/auto-commit-provider-binding.js'

describe('resolveAutoCommitProviderBinding', () => {
  it('reuses the executor tool binding when auto-commit model is not overridden', () => {
    expect(resolveAutoCommitProviderBinding({
      executorTool: 'gemini',
      executorModel: 'gemini',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'gemini',
      model: 'gemini',
    })
  })

  it('preserves the executor agent for routed kiro bindings', () => {
    expect(resolveAutoCommitProviderBinding({
      executorTool: 'kiro',
      executorModel: 'kiro',
      executorAgent: 'dev',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'kiro',
      model: 'kiro',
      agent: 'dev',
    })
  })

  it('defaults to the executor dev agent for kiro bindings when agent is omitted', () => {
    expect(resolveAutoCommitProviderBinding({
      executorTool: 'kiro',
      executorModel: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'kiro',
      model: 'kiro',
      agent: 'dev',
    })
  })

  it('keeps a usable kiro agent when auto-commit model is explicitly overridden', () => {
    expect(resolveAutoCommitProviderBinding({
      autoCommitModel: 'kiro',
      executorModel: 'codex',
      executorAgent: 'architect',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      model: 'kiro',
      agent: 'architect',
    })
  })

  it('keeps a model-only codex executor on the codex CLI path when overriding the model', () => {
    expect(resolveAutoCommitProviderBinding({
      autoCommitModel: 'gpt-5.4',
      executorModel: 'codex',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'codex',
      model: 'gpt-5.4',
    })
  })

  it('keeps the executor tool when overriding only the auto-commit model', () => {
    expect(resolveAutoCommitProviderBinding({
      autoCommitModel: 'claude-sonnet-4-6',
      executorTool: 'kiro',
      executorModel: 'kiro',
      executorAgent: 'architect',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'kiro',
      model: 'claude-sonnet-4-6',
      agent: 'architect',
    })
  })

  it('keeps the implicit dev agent when overriding the model on a kiro tool binding', () => {
    expect(resolveAutoCommitProviderBinding({
      autoCommitModel: 'claude-sonnet-4-6',
      executorTool: 'kiro',
      executorModel: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'kiro',
      model: 'claude-sonnet-4-6',
      agent: 'dev',
    })
  })

  it('keeps a model-only kiro executor on the kiro CLI path when overriding the model', () => {
    expect(resolveAutoCommitProviderBinding({
      autoCommitModel: 'claude-sonnet-4-6',
      executorModel: 'kiro',
    })).toEqual({
      logicalName: 'capabilities.loop.auto_commit',
      tool: 'kiro',
      model: 'claude-sonnet-4-6',
      agent: 'dev',
    })
  })
})

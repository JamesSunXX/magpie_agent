import { describe, expect, it } from 'vitest'
import {
  resolveLoopStageBinding,
  resolveRescueBinding,
} from '../../../src/capabilities/loop/domain/stage-bindings.js'

describe('resolveLoopStageBinding', () => {
  const runtime = {
    plannerTool: 'claude',
    plannerModel: 'claude-code',
    plannerAgent: 'architect',
    executorTool: 'codex',
    executorModel: 'codex',
    executorAgent: 'dev',
  }

  it('resolves planner-style defaults for early planning stages', () => {
    expect(resolveLoopStageBinding('prd_review', runtime)).toEqual({
      primary: { tool: 'claude', model: 'claude-code', agent: 'architect' },
      reviewer: { tool: 'gemini-cli', model: 'gemini-cli' },
      rescue: { tool: 'kiro', model: 'kiro', agent: 'architect' },
    })
  })

  it('applies stage overrides on top of defaults', () => {
    expect(
      resolveLoopStageBinding('implementation', runtime, {
        implementation: {
          reviewer: { tool: 'codex' },
          rescue: { tool: 'kiro', agent: 'dev' },
        },
      })
    ).toEqual({
      primary: { tool: 'codex', model: 'codex', agent: 'dev' },
      reviewer: { tool: 'codex' },
      rescue: { tool: 'kiro', agent: 'dev' },
    })
  })

  it('uses planner-style reviewers for the middle preparation stage by default', () => {
    expect(resolveLoopStageBinding('dev_preparation', runtime).reviewer).toEqual({
      tool: 'claude',
      model: 'claude-code',
      agent: 'architect',
    })
  })

  it('resolves the default rescue binding when no override is configured', () => {
    expect(resolveRescueBinding('implementation', runtime)).toEqual({
      tool: 'kiro',
      model: 'kiro',
      agent: 'dev',
    })

    expect(resolveRescueBinding('integration_test', runtime)).toEqual({
      tool: 'kiro',
      model: 'kiro',
      agent: 'dev',
    })
  })

  it('reuses the stage rescue binding when an override is configured', () => {
    expect(
      resolveRescueBinding('integration_test', runtime, {
        integration_test: {
          rescue: { tool: 'kiro', agent: 'dev' },
        },
      })
    ).toEqual({ tool: 'kiro', agent: 'dev' })
  })
})

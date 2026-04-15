import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/platform/providers/index.js', () => ({
  createConfiguredProvider: vi.fn(),
}))

import { createConfiguredProvider } from '../../../src/platform/providers/index.js'
import { runLoopModelConfirmation } from '../../../src/capabilities/loop/domain/model-confirmation.js'

afterEach(() => {
  vi.resetAllMocks()
})

describe('runLoopModelConfirmation', () => {
  it('fails fast when no reviewers are configured for multi-model gating', async () => {
    await expect(runLoopModelConfirmation({
      stage: 'code_development',
      goal: 'Ship the fix safely',
      stageReport: 'Stage output',
      testOutput: 'Tests pending',
      risks: [],
      reviewerIds: [],
      config: {
        providers: {},
        defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
        reviewers: {},
        summarizer: { model: 'mock', prompt: 'summarize' },
        analyzer: { model: 'mock', prompt: 'analyze' },
        capabilities: {},
        integrations: {},
      } as never,
      cwd: '/tmp/magpie-model-confirmation',
    })).rejects.toThrow('multi_model gate requires at least one reviewer')

    expect(createConfiguredProvider).not.toHaveBeenCalled()
  })
})

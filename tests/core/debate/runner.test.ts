import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDebateSession } from '../../../src/core/debate/runner.js'

const run = vi.fn()
const runStreaming = vi.fn()

vi.mock('../../../src/orchestrator/orchestrator.js', () => ({
  DebateOrchestrator: vi.fn().mockImplementation(function DebateOrchestratorMock() {
    return {
    run,
    runStreaming,
    }
  }),
}))

describe('core debate runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    run.mockResolvedValue({ mode: 'non-streaming' })
    runStreaming.mockResolvedValue({ mode: 'streaming' })
  })

  it('uses non-streaming execution when explicitly disabled', async () => {
    const result = await runDebateSession({
      reviewers: [] as never,
      summarizer: {} as never,
      analyzer: {} as never,
      options: {} as never,
      label: 'label',
      prompt: 'prompt',
      streaming: false,
    })

    expect(run).toHaveBeenCalledWith('label', 'prompt')
    expect(runStreaming).not.toHaveBeenCalled()
    expect(result).toEqual({ mode: 'non-streaming' })
  })

  it('uses streaming execution by default', async () => {
    const result = await runDebateSession({
      reviewers: [] as never,
      summarizer: {} as never,
      analyzer: {} as never,
      options: {} as never,
      label: 'label',
      prompt: 'prompt',
    })

    expect(runStreaming).toHaveBeenCalledWith('label', 'prompt')
    expect(run).not.toHaveBeenCalled()
    expect(result).toEqual({ mode: 'streaming' })
  })
})

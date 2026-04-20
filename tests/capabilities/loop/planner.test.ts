import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIProvider, Message, ChatOptions } from '../../../src/platform/providers/index.js'
import { generateLoopPlan } from '../../../src/capabilities/loop/domain/planner.js'

describe('generateLoopPlan', () => {
  afterEach(() => {
    delete process.env.MAGPIE_LOOP_PLANNER_TIMEOUT_MS
    vi.useRealTimers()
  })

  it('disables tools for the planner call', async () => {
    const chat = vi.fn(async (_messages: Message[], _systemPrompt?: string, _options?: ChatOptions) => '```json\n{"tasks":[]}\n```')
    const planner: AIProvider = {
      name: 'mock',
      chat,
      async *chatStream() {},
    }

    await generateLoopPlan(
      planner,
      'Ship harness fix',
      '/tmp/prd.md',
      ['prd_review']
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      { disableTools: true }
    )
  })

  it('falls back to default tasks when planner chat fails', async () => {
    const planner: AIProvider = {
      name: 'mock',
      chat: vi.fn(async () => {
        throw new Error('planner timed out')
      }),
      async *chatStream() {},
    }

    const tasks = await generateLoopPlan(
      planner,
      'Ship harness fix',
      '/tmp/prd.md',
      ['prd_review', 'code_development' as never]
    )

    expect(tasks).toEqual([
      {
        id: 'task-1',
        stage: 'prd_review',
        title: 'PRD review',
        description: 'Review the PRD and lock the core problem, scope, and acceptance bar for: Ship harness fix',
        dependencies: [],
        successCriteria: ['PRD scope, assumptions, and open questions are clear for execution'],
      },
      {
        id: 'task-2',
        stage: 'code_development',
        title: 'Implementation',
        description: 'Make the primary code changes required to deliver: Ship harness fix',
        dependencies: ['task-1'],
        successCriteria: ['The planned code changes are in place and aligned with the accepted scope'],
      },
    ])
  })

  it('falls back to default tasks when planner chat hangs past the timeout', async () => {
    vi.useFakeTimers()
    process.env.MAGPIE_LOOP_PLANNER_TIMEOUT_MS = '10'

    const planner: AIProvider = {
      name: 'mock',
      chat: vi.fn(() => new Promise<string>(() => {})),
      async *chatStream() {},
    }

    const tasksPromise = generateLoopPlan(
      planner,
      'Ship harness fix',
      '/tmp/prd.md',
      ['prd_review']
    )

    await vi.advanceTimersByTimeAsync(11)
    const tasks = await tasksPromise

    expect(tasks).toEqual([
      {
        id: 'task-1',
        stage: 'prd_review',
        title: 'PRD review',
        description: 'Review the PRD and lock the core problem, scope, and acceptance bar for: Ship harness fix',
        dependencies: [],
        successCriteria: ['PRD scope, assumptions, and open questions are clear for execution'],
      },
    ])
  })
})

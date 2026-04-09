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
      ['prd_review', 'code_development']
    )

    expect(tasks).toEqual([
      {
        id: 'task-1',
        stage: 'prd_review',
        title: 'prd_review',
        description: 'Execute stage prd_review for goal: Ship harness fix',
        dependencies: [],
        successCriteria: ['Stage prd_review completed without blocking issues'],
      },
      {
        id: 'task-2',
        stage: 'code_development',
        title: 'code_development',
        description: 'Execute stage code_development for goal: Ship harness fix',
        dependencies: ['task-1'],
        successCriteria: ['Stage code_development completed without blocking issues'],
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
        title: 'prd_review',
        description: 'Execute stage prd_review for goal: Ship harness fix',
        dependencies: [],
        successCriteria: ['Stage prd_review completed without blocking issues'],
      },
    ])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WorkflowSession } from '../../src/capabilities/workflows/shared/runtime.js'
import {
  createHarnessProgressReporter,
  followHarnessEventStream,
  formatHarnessEventLine,
} from '../../src/cli/commands/harness-progress.js'

describe('harness progress helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats persisted harness events for terminal output', () => {
    expect(formatHarnessEventLine({
      sessionId: 'harness-1',
      timestamp: '2026-04-11T00:00:00.000Z',
      type: 'cycle_completed',
      stage: 'reviewing',
      cycle: 2,
      summary: 'Cycle 2 approved.',
    })).toBe('2026-04-11T00:00:00.000Z cycle_completed stage=reviewing cycle=2 Cycle 2 approved.')
  })

  it('formats nested loop provider progress events for terminal output', () => {
    expect(formatHarnessEventLine({
      sessionId: 'harness-1',
      ts: '2026-04-11T00:00:01.000Z',
      event: 'provider_progress',
      stage: 'code_development',
      provider: 'codex',
      progressType: 'item.started',
      summary: 'Running shell command.',
    } as never)).toBe('2026-04-11T00:00:01.000Z stage=code_development Codex 正在执行命令。')
  })

  it('prints session discovery, streamed events, and idle heartbeats', () => {
    const log = vi.fn()
    let now = new Date('2026-04-11T00:00:00.000Z').getTime()
    const reporter = createHarnessProgressReporter({
      log,
      heartbeatMs: 30_000,
      now: () => new Date(now),
    })

    reporter.start()
    reporter.onSessionUpdate(sessionFixture())
    reporter.onEvent({
      sessionId: 'harness-1',
      timestamp: '2026-04-11T00:00:05.000Z',
      type: 'stage_changed',
      stage: 'developing',
      summary: 'Running loop development stage.',
    })

    now += 30_000
    vi.advanceTimersByTime(30_000)

    expect(log).toHaveBeenCalledWith('Session: harness-1')
    expect(log).toHaveBeenCalledWith('Status: in_progress')
    expect(log).toHaveBeenCalledWith('Stage: queued')
    expect(log).toHaveBeenCalledWith('Events: /tmp/harness/events.jsonl')
    expect(log).toHaveBeenCalledWith('2026-04-11T00:00:05.000Z stage_changed stage=developing Running loop development stage.')
    expect(log).toHaveBeenCalledWith('Heartbeat: session harness-1 stage=developing still running.')

    reporter.stop()
  })

  it('follows new events until the session completes', async () => {
    vi.useRealTimers()
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-follow-'))
    const eventsPath = join(dir, 'events.jsonl')
    writeFileSync(eventsPath, `${JSON.stringify({
      timestamp: '2026-04-11T00:00:00.000Z',
      type: 'workflow_started',
      stage: 'queued',
      summary: 'Harness workflow started.',
    })}\n`, 'utf-8')

    const log = vi.fn()
    const loadSession = vi.fn()
      .mockResolvedValueOnce({
        ...sessionFixture(),
        currentStage: 'reviewing',
        status: 'in_progress',
        artifacts: { eventsPath },
      } satisfies WorkflowSession)
      .mockResolvedValueOnce({
        ...sessionFixture(),
        currentStage: 'completed',
        status: 'completed',
        artifacts: { eventsPath },
      } satisfies WorkflowSession)

    const followPromise = followHarnessEventStream({
      sessionId: 'harness-1',
      initialSession: {
        ...sessionFixture(),
        status: 'in_progress',
        artifacts: { eventsPath },
      },
      log,
      loadSession,
      pollIntervalMs: 10,
      idleHeartbeatMs: 60_000,
    })

    await new Promise((resolve) => setTimeout(resolve, 5))
    writeFileSync(eventsPath, [
      JSON.stringify({
        timestamp: '2026-04-11T00:00:00.000Z',
        type: 'workflow_started',
        stage: 'queued',
        summary: 'Harness workflow started.',
      }),
      JSON.stringify({
        timestamp: '2026-04-11T00:00:10.000Z',
        type: 'workflow_completed',
        stage: 'completed',
        summary: 'Harness approved after 1 cycle(s).',
      }),
    ].join('\n'), 'utf-8')

    await new Promise((resolve) => setTimeout(resolve, 30))
    await followPromise

    expect(log).toHaveBeenCalledWith('2026-04-11T00:00:00.000Z workflow_started stage=queued Harness workflow started.')
    expect(log).toHaveBeenCalledWith('Watching harness-1 for new events. Press Ctrl+C to stop.')
    expect(log).toHaveBeenCalledWith('2026-04-11T00:00:10.000Z workflow_completed stage=completed Harness approved after 1 cycle(s).')

    rmSync(dir, { recursive: true, force: true })
    vi.useFakeTimers()
  })

  it('prints nested loop events when a harness session references a loop stream', async () => {
    vi.useRealTimers()
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-follow-nested-'))
    const harnessEventsPath = join(dir, 'harness-events.jsonl')
    const loopEventsPath = join(dir, 'loop-events.jsonl')
    writeFileSync(harnessEventsPath, `${JSON.stringify({
      timestamp: '2026-04-11T00:00:00.000Z',
      type: 'workflow_started',
      stage: 'queued',
      summary: 'Harness workflow started.',
    })}\n`, 'utf-8')
    writeFileSync(loopEventsPath, `${JSON.stringify({
      ts: '2026-04-11T00:00:03.000Z',
      event: 'provider_progress',
      stage: 'code_development',
      provider: 'codex',
      progressType: 'turn.started',
      summary: 'Codex turn started.',
    })}\n`, 'utf-8')

    const log = vi.fn()

    await followHarnessEventStream({
      sessionId: 'harness-1',
      initialSession: {
        ...sessionFixture(),
        status: 'completed',
        artifacts: {
          eventsPath: harnessEventsPath,
          loopSessionId: 'loop-1',
          loopEventsPath,
        },
      },
      log,
      loadSession: vi.fn().mockResolvedValue(null),
      once: true,
    })

    expect(log).toHaveBeenCalledWith('2026-04-11T00:00:00.000Z workflow_started stage=queued Harness workflow started.')
    expect(log).toHaveBeenCalledWith('2026-04-11T00:00:03.000Z stage=code_development Codex 开始处理当前步骤。')

    rmSync(dir, { recursive: true, force: true })
    vi.useFakeTimers()
  })

  it('prints persisted round narrative after a completed cycle event', async () => {
    vi.useRealTimers()
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-follow-cycle-'))
    const eventsPath = join(dir, 'events.jsonl')
    const roleRoundsDir = join(dir, 'rounds')
    mkdirSync(roleRoundsDir, { recursive: true })
    writeFileSync(eventsPath, [
      JSON.stringify({
        timestamp: '2026-04-11T00:00:00.000Z',
        type: 'workflow_started',
        stage: 'queued',
        summary: 'Harness workflow started.',
      }),
      JSON.stringify({
        timestamp: '2026-04-11T00:00:10.000Z',
        type: 'cycle_completed',
        stage: 'reviewing',
        cycle: 1,
        summary: 'Cycle 1 requested more changes.',
      }),
    ].join('\n'), 'utf-8')
    writeFileSync(join(roleRoundsDir, 'cycle-1.json'), JSON.stringify({
      roles: [
        { roleId: 'developer', displayName: 'developer', binding: { tool: 'codex' } },
        { roleId: 'reviewer-1', displayName: 'security', binding: { tool: 'claude-code' } },
      ],
      reviewResults: [
        { reviewerRoleId: 'reviewer-1', summary: 'Missing rollback handling.' },
      ],
      arbitrationResult: {
        summary: 'Need another cycle after rollback fixes.',
      },
    }, null, 2), 'utf-8')

    const log = vi.fn()

    await followHarnessEventStream({
      sessionId: 'harness-1',
      initialSession: {
        ...sessionFixture(),
        status: 'completed',
        artifacts: { eventsPath, roleRoundsDir },
      },
      log,
      loadSession: vi.fn().mockResolvedValue(null),
      once: true,
    })

    expect(log).toHaveBeenCalledWith('Participants: developer=codex, reviewer-1=claude-code')
    expect(log).toHaveBeenCalledWith('Review notes: reviewer-1: Missing rollback handling.')
    expect(log).toHaveBeenCalledWith('Decision note: Need another cycle after rollback fixes.')

    rmSync(dir, { recursive: true, force: true })
    vi.useFakeTimers()
  })
})

function sessionFixture(): WorkflowSession {
  return {
    id: 'harness-1',
    capability: 'harness',
    title: 'Checkout',
    createdAt: new Date('2026-04-11T00:00:00.000Z'),
    updatedAt: new Date('2026-04-11T00:00:00.000Z'),
    status: 'in_progress',
    currentStage: 'queued',
    summary: 'Queued.',
    artifacts: {
      eventsPath: '/tmp/harness/events.jsonl',
    },
  }
}

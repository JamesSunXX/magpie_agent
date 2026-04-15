import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendHumanConfirmationItem,
  findHumanConfirmationDecision,
  findLatestPendingHumanConfirmationInQueue,
  findLatestPendingHumanConfirmationForSession,
  parseHumanConfirmationBlocks,
  renderHumanConfirmationBlock,
  summarizeHumanConfirmationReason,
  syncSessionHumanConfirmationProjection,
  updateHumanConfirmationItem,
} from '../../../src/capabilities/loop/domain/human-confirmation.js'
import type { HumanConfirmationItem } from '../../../src/state/types.js'

function makeItem(): HumanConfirmationItem {
  const now = new Date('2026-03-05T12:00:00Z')
  return {
    id: 'hc-1',
    sessionId: 'session-1',
    stage: 'trd_generation',
    status: 'pending',
    decision: 'pending',
    rationale: '',
    reason: 'Need product owner decision',
    artifacts: ['/tmp/a.md'],
    nextAction: 'Approve or reject',
    createdAt: now,
    updatedAt: now,
  }
}

describe('human confirmation markdown protocol', () => {
  it('renders and parses a markdown block', () => {
    const rendered = renderHumanConfirmationBlock(makeItem())
    const parsed = parseHumanConfirmationBlocks(rendered)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('hc-1')
    expect(parsed[0].sessionId).toBe('session-1')
    expect(parsed[0].stage).toBe('trd_generation')
  })

  it('appends to markdown file and can be queried by id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-hc-'))
    const file = join(dir, 'human_confirmation.md')

    await appendHumanConfirmationItem(file, makeItem())

    const content = readFileSync(file, 'utf-8')
    expect(content).toContain('MAGPIE_HUMAN_CONFIRMATION_START')

    const found = await findHumanConfirmationDecision(file, 'hc-1')
    expect(found).not.toBeNull()
    expect(found?.status).toBe('pending')
  })

  it('returns line number for the latest appended block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-hc-line-'))
    const file = join(dir, 'human_confirmation.md')

    const first = makeItem()
    first.id = 'hc-1'
    const line1 = await appendHumanConfirmationItem(file, first)

    const second = makeItem()
    second.id = 'hc-2'
    const line2 = await appendHumanConfirmationItem(file, second)

    expect(line2).toBeGreaterThan(line1)

    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')
    expect(lines[line2 - 1]).toContain('MAGPIE_HUMAN_CONFIRMATION_START')
  })

  it('finds the latest pending item for a session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-hc-pending-'))
    const file = join(dir, 'human_confirmation.md')

    const first = makeItem()
    first.id = 'hc-1'
    first.updatedAt = new Date('2026-03-05T12:00:00Z')
    await appendHumanConfirmationItem(file, first)

    const second = makeItem()
    second.id = 'hc-2'
    second.updatedAt = new Date('2026-03-05T12:05:00Z')
    second.decision = 'approved'
    second.status = 'approved'
    await appendHumanConfirmationItem(file, second)

    const third = makeItem()
    third.id = 'hc-3'
    third.updatedAt = new Date('2026-03-05T12:10:00Z')
    third.summary = 'Need one final decision'
    await appendHumanConfirmationItem(file, third)

    const latest = await findLatestPendingHumanConfirmationForSession(file, 'session-1')

    expect(latest?.id).toBe('hc-3')
    expect(latest?.summary).toBe('Need one final decision')
  })

  it('finds the latest pending item from session state before touching the summary file', () => {
    const approved = makeItem()
    approved.id = 'hc-1'
    approved.decision = 'approved'
    approved.status = 'approved'

    const pending = makeItem()
    pending.id = 'hc-2'
    pending.summary = 'Current session card'
    pending.updatedAt = new Date('2026-03-05T12:10:00Z')

    const latest = findLatestPendingHumanConfirmationInQueue([approved, pending], 'session-1')

    expect(latest?.id).toBe('hc-2')
    expect(latest?.summary).toBe('Current session card')
  })

  it('updates an existing confirmation item without losing other entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-hc-update-'))
    const file = join(dir, 'human_confirmation.md')

    const first = makeItem()
    first.id = 'hc-1'
    await appendHumanConfirmationItem(file, first)

    const second = makeItem()
    second.id = 'hc-2'
    second.sessionId = 'session-2'
    await appendHumanConfirmationItem(file, second)

    const updatedLine = await updateHumanConfirmationItem(file, 'hc-1', {
      decision: 'rejected',
      status: 'rejected',
      rationale: 'Need tighter rollback handling.',
      parentId: 'hc-parent',
      discussionSessionId: 'disc-123',
      discussionOutputPath: '/tmp/discussion.md',
    })

    const items = parseHumanConfirmationBlocks(readFileSync(file, 'utf-8'))

    expect(updatedLine).toBeGreaterThan(0)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'hc-1',
      decision: 'rejected',
      status: 'rejected',
      rationale: 'Need tighter rollback handling.',
      parentId: 'hc-parent',
      discussionSessionId: 'disc-123',
      discussionOutputPath: '/tmp/discussion.md',
    })
    expect(items[1].id).toBe('hc-2')
  })

  it('rewrites the summary file from session state while preserving other sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-hc-sync-'))
    const file = join(dir, 'human_confirmation.md')

    const current = makeItem()
    current.id = 'hc-session'
    current.summary = 'Session state wins'

    const stale = makeItem()
    stale.id = 'hc-stale'
    stale.reason = 'Old file-only item'
    await appendHumanConfirmationItem(file, stale)

    const otherSession = makeItem()
    otherSession.id = 'hc-other'
    otherSession.sessionId = 'session-2'
    otherSession.reason = 'Other session should stay'
    await appendHumanConfirmationItem(file, otherSession)

    const line = await syncSessionHumanConfirmationProjection(file, current.sessionId, [current])
    const items = parseHumanConfirmationBlocks(readFileSync(file, 'utf-8'))

    expect(line).toBeGreaterThan(0)
    expect(items.map((item) => item.id)).toEqual(['hc-other', 'hc-session'])
    expect(items.find((item) => item.id === 'hc-session')?.summary).toBe('Session state wins')
  })

  it('condenses verbose reasons into a short decision card summary', () => {
    const summary = summarizeHumanConfirmationReason([
      'buildRelatedJobs still queries only the first job id',
      'ParseLookbackDuration does not support 1d bucket size',
      'Traces compare overwrites same node type retries',
      'tests are missing route-level coverage',
    ].join('; '))

    expect(summary.summary).toBe('4 items need a decision before continuing.')
    expect(summary.reason).toContain('buildRelatedJobs still queries only the first job id')
    expect(summary.reason).toContain('ParseLookbackDuration does not support 1d bucket size')
    expect(summary.reason).toContain('Traces compare overwrites same node type retries')
    expect(summary.reason).not.toContain('tests are missing route-level coverage')
    expect(summary.recommendation).toBe('reject')
  })
})

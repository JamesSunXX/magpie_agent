import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendHumanConfirmationItem,
  findHumanConfirmationDecision,
  parseHumanConfirmationBlocks,
  renderHumanConfirmationBlock,
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
})

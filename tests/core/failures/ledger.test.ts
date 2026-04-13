import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendFailureRecord,
  readFailureIndex,
} from '../../../src/core/failures/ledger.js'
import type { FailureRecord } from '../../../src/core/failures/types.js'

function makeRecord(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    id: overrides.id || `failure-${Math.random().toString(16).slice(2, 8)}`,
    sessionId: overrides.sessionId || 'loop-123',
    capability: overrides.capability || 'loop',
    stage: overrides.stage || 'code_development',
    timestamp: overrides.timestamp || '2026-04-12T10:00:00.000Z',
    signature: overrides.signature || 'shared-signature',
    category: overrides.category || 'quality',
    reason: overrides.reason || 'Implementation still fails tests',
    retryable: overrides.retryable ?? false,
    selfHealCandidate: overrides.selfHealCandidate ?? false,
    lastReliablePoint: overrides.lastReliablePoint || 'development_completed',
    evidencePaths: overrides.evidencePaths || ['/tmp/evidence.log'],
    metadata: overrides.metadata || {},
    recoveryAction: overrides.recoveryAction || 'block_for_human',
  }
}

describe('failure ledger', () => {
  let cwd: string

  afterEach(() => {
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('writes session failure records and updates the repository index', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-failure-ledger-'))
    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-123')

    const result = await appendFailureRecord({
      repoRoot: cwd,
      sessionDir,
      record: makeRecord(),
    })

    const sessionFailure = JSON.parse(readFileSync(result.recordPath, 'utf-8')) as FailureRecord
    const index = JSON.parse(readFileSync(result.indexPath, 'utf-8')) as {
      entries: Array<{ signature: string; count: number }>
    }

    expect(sessionFailure.signature).toBe('shared-signature')
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({
      signature: 'shared-signature',
      count: 1,
    })
  })

  it('aggregates duplicate signatures across writes and capabilities', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-failure-ledger-'))

    await appendFailureRecord({
      repoRoot: cwd,
      sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-123'),
      record: makeRecord({
        sessionId: 'loop-123',
        capability: 'loop',
        signature: 'shared-signature',
      }),
    })
    await appendFailureRecord({
      repoRoot: cwd,
      sessionDir: join(cwd, '.magpie', 'sessions', 'harness', 'harness-123'),
      record: makeRecord({
        sessionId: 'harness-123',
        capability: 'harness',
        signature: 'shared-signature',
      }),
    })

    const index = await readFailureIndex(cwd)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({
      signature: 'shared-signature',
      count: 2,
      capabilities: {
        loop: 1,
        harness: 1,
      },
    })
  })

  it('keeps counts intact under concurrent writes', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-failure-ledger-'))

    await Promise.all([
      appendFailureRecord({
        repoRoot: cwd,
        sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-a'),
        record: makeRecord({ id: 'failure-a', sessionId: 'loop-a', signature: 'race-signature' }),
      }),
      appendFailureRecord({
        repoRoot: cwd,
        sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-b'),
        record: makeRecord({ id: 'failure-b', sessionId: 'loop-b', signature: 'race-signature' }),
      }),
    ])

    const index = await readFailureIndex(cwd)
    expect(index.entries.find((entry) => entry.signature === 'race-signature')?.count).toBe(2)
  })

  it('does not increment the repository index for derived failures that should not count twice', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-failure-ledger-'))

    await appendFailureRecord({
      repoRoot: cwd,
      sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-123'),
      record: makeRecord({
        sessionId: 'loop-123',
        capability: 'loop',
        signature: 'shared-signature',
      }),
    })

    await appendFailureRecord({
      repoRoot: cwd,
      sessionDir: join(cwd, '.magpie', 'sessions', 'harness', 'harness-123'),
      record: makeRecord({
        sessionId: 'harness-123',
        capability: 'harness',
        signature: 'shared-signature',
        metadata: {
          sourceFailureSignature: 'shared-signature',
          countTowardFailureIndex: false,
        },
      }),
    })

    const index = await readFailureIndex(cwd)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({
      signature: 'shared-signature',
      count: 1,
      capabilities: {
        loop: 1,
      },
    })
  })
})

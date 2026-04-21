import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistWorkflowSession } from '../../../src/capabilities/workflows/shared/runtime.js'
import { buildUnifiedStatusSummary, formatUnifiedStatusSummary } from '../../../src/capabilities/workflows/shared/status-summary.js'

describe('unified status summary', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('summarizes recent task state and next actions across workflow sessions', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-status-'))
    dirs.push(cwd)

    await Promise.all([
      persistWorkflowSession(cwd, {
        id: 'harness-running',
        capability: 'harness',
        title: 'Ship checkout',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-16T00:10:00.000Z'),
        status: 'in_progress',
        currentStage: 'developing',
        summary: 'Development is running.',
        artifacts: {},
      }),
      persistWorkflowSession(cwd, {
        id: 'harness-failed',
        capability: 'harness',
        title: 'Fix payment',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-16T00:09:00.000Z'),
        status: 'failed',
        currentStage: 'reviewing',
        summary: 'Review failed.',
        artifacts: {},
        evidence: { runtime: { lastError: 'tests failed' } },
      }),
      persistWorkflowSession(cwd, {
        id: 'harness-waiting',
        capability: 'harness',
        title: 'Approve release',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-16T00:08:00.000Z'),
        status: 'blocked',
        currentStage: 'developing',
        summary: 'Waiting for human confirmation.',
        artifacts: {},
      }),
      persistWorkflowSession(cwd, {
        id: 'harness-done',
        capability: 'harness',
        title: 'Update docs',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-16T00:07:00.000Z'),
        status: 'completed',
        currentStage: 'completed',
        summary: 'Completed.',
        artifacts: {},
      }),
    ])

    const summary = await buildUnifiedStatusSummary(cwd, { limit: 10 })
    const rendered = formatUnifiedStatusSummary(summary)

    expect(summary.counts).toMatchObject({
      running: 1,
      failed: 1,
      waiting: 1,
      completed: 1,
    })
    expect(rendered).toContain('harness-running')
    expect(rendered).toContain('Next: wait for current stage to finish')
    expect(rendered).toContain('tests failed')
    expect(rendered).toContain('Next: inspect with magpie harness inspect harness-failed')
  })
})

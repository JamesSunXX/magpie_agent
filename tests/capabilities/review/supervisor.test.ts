import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { StateManager } from '../../../src/state/state-manager.js'
import type { ReviewSession } from '../../../src/state/types.js'
import {
  superviseReviewSession,
  verifyReviewSessionReadyForSummary,
} from '../../../src/capabilities/review/application/supervisor.js'

function createSession(id: string, selectedFeatures: string[]): ReviewSession {
  return {
    id,
    startedAt: new Date('2026-04-12T00:00:00.000Z'),
    updatedAt: new Date('2026-04-12T00:05:00.000Z'),
    status: 'paused',
    config: {
      focusAreas: ['security'],
      selectedFeatures,
    },
    plan: {
      features: selectedFeatures.map((featureId) => ({
        id: featureId,
        name: featureId.toUpperCase(),
        description: `${featureId} feature`,
        entryPoints: [`src/${featureId}.ts`],
        files: [
          {
            path: `/repo/src/${featureId}.ts`,
            relativePath: `src/${featureId}.ts`,
            language: 'typescript',
            lines: 10,
            size: 40,
          },
        ],
        estimatedTokens: 10,
      })),
      totalFeatures: selectedFeatures.length,
      selectedCount: selectedFeatures.length,
    },
    progress: {
      currentFeatureIndex: 0,
      completedFeatures: [],
      featureResults: {},
    },
  }
}

describe('review supervisor', () => {
  let tempDir: string
  let manager: StateManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'magpie-review-supervisor-'))
    manager = new StateManager(tempDir)
    await manager.init()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('bootstraps missing round files from legacy session progress and resumes from the next round', async () => {
    const session = createSession('legacy-review-1', ['discuss', 'trd', 'loop'])
    session.progress.currentFeatureIndex = 2
    session.progress.completedFeatures = ['discuss', 'trd']
    session.progress.featureResults = {
      discuss: {
        featureId: 'discuss',
        issues: [],
        summary: 'Discuss looks fine',
        reviewedAt: new Date('2026-04-12T00:01:00.000Z'),
      },
      trd: {
        featureId: 'trd',
        issues: [],
        summary: 'TRD looks fine',
        reviewedAt: new Date('2026-04-12T00:02:00.000Z'),
      },
    }
    await manager.saveSession(session)

    const report = await superviseReviewSession(manager, session)

    expect(report.bootstrappedRounds).toBe(2)
    expect(report.lastSuccessfulRound).toBe(2)
    expect(report.nextRoundNumber).toBe(3)

    const checkpoints = await manager.listReviewRoundCheckpoints(session.id)
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[0]?.origin).toBe('recovered_from_session')

    const saved = await manager.loadSession(session.id)
    expect(saved?.progress.completedFeatures).toEqual(['discuss', 'trd'])
    expect(saved?.checkpointing?.lastVerifiedRound).toBe(2)
  })

  it('withholds final summary until every selected round has a verified checkpoint', async () => {
    const session = createSession('summary-gate-1', ['discuss', 'trd'])
    session.progress.currentFeatureIndex = 2
    session.progress.completedFeatures = ['discuss', 'trd']
    session.progress.featureResults = {
      discuss: {
        featureId: 'discuss',
        issues: [],
        summary: 'Discuss looks fine',
        reviewedAt: new Date('2026-04-12T00:01:00.000Z'),
      },
      trd: {
        featureId: 'trd',
        issues: [],
        summary: 'TRD looks fine',
        reviewedAt: new Date('2026-04-12T00:02:00.000Z'),
      },
    }
    await manager.saveSession(session)
    await manager.saveReviewRoundCheckpoint(session.id, {
      schemaVersion: 1,
      sessionId: session.id,
      roundNumber: 1,
      featureId: 'discuss',
      featureName: 'DISCUSS',
      status: 'completed',
      origin: 'live',
      focusAreas: ['security'],
      filePaths: ['src/discuss.ts'],
      reviewerOutputs: [],
      result: session.progress.featureResults.discuss,
      completedAt: new Date('2026-04-12T00:01:00.000Z'),
    })

    expect(await verifyReviewSessionReadyForSummary(manager, session)).toBe(false)

    await manager.saveReviewRoundCheckpoint(session.id, {
      schemaVersion: 1,
      sessionId: session.id,
      roundNumber: 2,
      featureId: 'trd',
      featureName: 'TRD',
      status: 'completed',
      origin: 'live',
      focusAreas: ['security'],
      filePaths: ['src/trd.ts'],
      reviewerOutputs: [],
      result: session.progress.featureResults.trd,
      completedAt: new Date('2026-04-12T00:02:00.000Z'),
    })

    expect(await verifyReviewSessionReadyForSummary(manager, session)).toBe(true)
  })
})

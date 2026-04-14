import type { StateManager, ReviewRoundCheckpoint, ReviewSession } from '../../../core/state/index.js'

export interface ReviewSupervisorReport {
  sessionId: string
  totalRounds: number
  lastSuccessfulRound: number
  nextRoundNumber: number
  bootstrappedRounds: number
  verifiedComplete: boolean
  session: ReviewSession
}

function buildLegacyCheckpoint(
  session: ReviewSession,
  featureId: string,
  roundNumber: number
): ReviewRoundCheckpoint | null {
  const result = session.progress.featureResults[featureId]
  if (!result) {
    return null
  }

  const feature = session.plan.features.find((item) => item.id === featureId)
  return {
    schemaVersion: 1,
    sessionId: session.id,
    roundNumber,
    featureId,
    featureName: feature?.name || featureId,
    status: 'completed',
    origin: 'recovered_from_session',
    focusAreas: session.config.focusAreas,
    filePaths: feature?.files.map((file) => file.relativePath) || [],
    reviewerOutputs: [],
    result,
    completedAt: result.reviewedAt,
  }
}

function collectLegacyCheckpoints(
  session: ReviewSession,
  checkpoints: ReviewRoundCheckpoint[]
): ReviewRoundCheckpoint[] {
  const pending: ReviewRoundCheckpoint[] = []
  const existingRounds = new Set(checkpoints.map((checkpoint) => checkpoint.roundNumber))

  for (const [index, featureId] of session.config.selectedFeatures.entries()) {
    if (!session.progress.completedFeatures.includes(featureId)) {
      continue
    }
    const roundNumber = index + 1
    if (existingRounds.has(roundNumber)) {
      continue
    }
    const checkpoint = buildLegacyCheckpoint(session, featureId, roundNumber)
    if (!checkpoint) {
      continue
    }
    existingRounds.add(roundNumber)
    pending.push(checkpoint)
  }

  return pending
}

function buildVerifiedSession(
  manager: StateManager,
  session: ReviewSession,
  checkpoints: ReviewRoundCheckpoint[],
  verifiedFeatureIds: string[],
  verifiedComplete: boolean
): ReviewSession {
  const verifiedResults = verifiedFeatureIds.reduce<Record<string, ReviewSession['progress']['featureResults'][string]>>((acc, featureId, index) => {
    const checkpoint = checkpoints.find((item) => item.roundNumber === index + 1)
    if (checkpoint) {
      acc[featureId] = checkpoint.result
    } else if (session.progress.featureResults[featureId]) {
      acc[featureId] = session.progress.featureResults[featureId]
    }
    return acc
  }, {})

  return {
    ...session,
    ...(verifiedComplete ? { status: 'completed' } : session.status === 'completed' ? { status: 'paused' } : {}),
    progress: {
      ...session.progress,
      currentFeatureIndex: verifiedFeatureIds.length,
      completedFeatures: verifiedFeatureIds,
      featureResults: {
        ...session.progress.featureResults,
        ...verifiedResults,
      },
    },
    checkpointing: {
      stateDir: manager.getReviewStateDir(session.id),
      totalRounds: session.config.selectedFeatures.length,
      lastCompletedRound: verifiedFeatureIds.length,
      lastVerifiedRound: verifiedFeatureIds.length,
      ...(verifiedComplete ? { finalSummaryVerifiedAt: session.checkpointing?.finalSummaryVerifiedAt } : {}),
    },
  }
}

export async function superviseReviewSession(
  manager: StateManager,
  session: ReviewSession,
  options?: { dryRun?: boolean }
): Promise<ReviewSupervisorReport> {
  const dryRun = options?.dryRun === true
  const existing = await manager.listReviewRoundCheckpoints(session.id)
  const pendingBootstraps = collectLegacyCheckpoints(session, existing)
  if (!dryRun) {
    for (const checkpoint of pendingBootstraps) {
      await manager.saveReviewRoundCheckpoint(session.id, checkpoint)
    }
  }
  const checkpoints = dryRun
    ? [...existing, ...pendingBootstraps].sort((a, b) => a.roundNumber - b.roundNumber)
    : pendingBootstraps.length > 0
      ? await manager.listReviewRoundCheckpoints(session.id)
      : existing

  const verifiedFeatureIds: string[] = []
  for (const [index, featureId] of session.config.selectedFeatures.entries()) {
    const checkpoint = checkpoints.find((item) => item.roundNumber === index + 1)
    if (!checkpoint || checkpoint.status !== 'completed' || checkpoint.featureId !== featureId) {
      break
    }
    verifiedFeatureIds.push(featureId)
  }

  const verifiedComplete = verifiedFeatureIds.length === session.config.selectedFeatures.length
  const recoveredSession = buildVerifiedSession(manager, session, checkpoints, verifiedFeatureIds, verifiedComplete)

  if (!dryRun) {
    await manager.saveSession({
      ...recoveredSession,
      updatedAt: new Date(),
    })
  }

  return {
    sessionId: session.id,
    totalRounds: session.config.selectedFeatures.length,
    lastSuccessfulRound: verifiedFeatureIds.length,
    nextRoundNumber: verifiedFeatureIds.length + 1,
    bootstrappedRounds: pendingBootstraps.length,
    verifiedComplete,
    session: dryRun ? recoveredSession : {
      ...recoveredSession,
      updatedAt: new Date(),
    },
  }
}

export async function superviseIncompleteReviewSessions(
  manager: StateManager,
  options?: { dryRun?: boolean }
): Promise<ReviewSupervisorReport[]> {
  const sessions = await manager.findIncompleteSessions()
  const reports: ReviewSupervisorReport[] = []

  for (const session of sessions) {
    reports.push(await superviseReviewSession(manager, session, options))
  }

  return reports
}

export async function verifyReviewSessionReadyForSummary(
  manager: StateManager,
  session: ReviewSession
): Promise<boolean> {
  const checkpoints = await manager.listReviewRoundCheckpoints(session.id)

  for (const [index, featureId] of session.config.selectedFeatures.entries()) {
    const checkpoint = checkpoints.find((item) => item.roundNumber === index + 1)
    if (!checkpoint || checkpoint.status !== 'completed' || checkpoint.featureId !== featureId) {
      return false
    }
  }

  return checkpoints.length >= session.config.selectedFeatures.length
}

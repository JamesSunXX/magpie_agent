import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { getMagpieHomeDir, getRepoMagpieDir, getRepoSessionsDir } from '../platform/paths.js'
import {
  recordHarnessGraphApprovalDecision,
  type HarnessGraphArtifact,
  type HarnessGraphApprovalGate,
  type HarnessGraphNode,
} from '../capabilities/workflows/harness-server/graph.js'
import { buildCommandDisplay, buildResumeArgv } from './command-builder.js'
import { CONTINUABLE_STATUSES } from './types.js'
import type { DashboardSessions, SessionCard } from './types.js'

interface ReviewSessionFile {
  id: string
  updatedAt: string
  status: string
}

interface DiscussSessionFile {
  id: string
  title: string
  updatedAt: string
  status: string
}

interface TrdSessionFile {
  id: string
  title?: string
  prdPath: string
  updatedAt: string
  stage: string
  artifacts: Record<string, string>
}

interface LoopSessionFile {
  id: string
  title: string
  updatedAt: string
  status: string
  artifacts: Record<string, string>
}

interface WorkflowSessionFile {
  id: string
  capability: SessionCard['capability']
  title: string
  status: string
  summary?: string
  currentStage?: string
  updatedAt: string
  artifacts?: Record<string, string>
}

interface HarnessRoleRoundSummary {
  finalAction?: string
  nextRoundBrief?: string
  roles?: Array<{
    roleId?: string
    roleType?: 'architect' | 'developer' | 'tester' | 'reviewer' | 'arbitrator'
    displayName?: string
  }>
  reviewResults?: Array<{
    reviewerRoleId?: string
    passed?: boolean
    summary?: string
  }>
  arbitrationResult?: {
    action?: string
    summary?: string
  }
  openIssues?: Array<{
    title?: string
    severity?: 'critical' | 'high' | 'medium' | 'low'
    sourceRole?: string
  }>
}

interface HarnessRoundIndexEntry {
  cycle: number
  finalAction: string
}

interface SessionDashboardOptions {
  cwd: string
  magpieHomeDir?: string
}

interface HarnessGraphInsight {
  detailSummary?: string
  selectedDetail?: Pick<NonNullable<SessionCard['selectedDetail']>, 'graphSummary' | 'attention' | 'readyNow' | 'recommendedAction' | 'recommendedCommand'>
}

function sortByUpdatedAtDesc(a: SessionCard, b: SessionCard): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime()
}

function toArtifactPaths(artifacts: Record<string, string> | undefined): string[] {
  return Object.values(artifacts || {}).filter((value): value is string => typeof value === 'string')
}

async function readJsonFiles<T>(dir: string): Promise<T[]> {
  try {
    const entries = await readdir(dir)
    return Promise.all(entries.filter((entry) => entry.endsWith('.json')).map(async (entry) => {
      const filePath = join(dir, entry)
      return JSON.parse(await readFile(filePath, 'utf-8')) as T
    }))
  } catch {
    return []
  }
}

async function loadSessionJsonCards<T>(dir: string): Promise<T[]> {
  const sessions: T[] = []

  try {
    const sessionDirs = await readdir(dir)
    for (const sessionDir of sessionDirs) {
      const filePath = join(dir, sessionDir, 'session.json')

      try {
        sessions.push(JSON.parse(await readFile(filePath, 'utf-8')) as T)
      } catch {
        // Ignore malformed or incomplete session directories.
      }
    }
  } catch {
    return []
  }

  return sessions
}

async function loadWorkflowSessions(repoMagpieDir: string): Promise<WorkflowSessionFile[]> {
  const baseDir = join(repoMagpieDir, 'sessions')
  const sessions: WorkflowSessionFile[] = []
  const workflowCapabilities = new Set(['harness', 'issue-fix', 'docs-sync', 'post-merge-regression'])

  try {
    const capabilityDirs = await readdir(baseDir)
    for (const capability of capabilityDirs) {
      if (!workflowCapabilities.has(capability)) {
        continue
      }
      const capabilityDir = join(baseDir, capability)
      const sessionDirs = await readdir(capabilityDir)

      for (const sessionDir of sessionDirs) {
        const filePath = join(capabilityDir, sessionDir, 'session.json')

        try {
          sessions.push(JSON.parse(await readFile(filePath, 'utf-8')) as WorkflowSessionFile)
        } catch {
          // Ignore malformed workflow sessions.
        }
      }
    }
  } catch {
    return []
  }

  return sessions
}

function isContinuable(card: SessionCard): boolean {
  return (CONTINUABLE_STATUSES as readonly string[]).includes(card.status)
    && Array.isArray(card.resumeCommand)
    && card.resumeCommand.length > 0
}

function withResumeCommand(card: SessionCard): SessionCard {
  return {
    ...card,
    resumeCommand: buildResumeArgv(card),
  }
}

function stripMarkdownPrefix(line: string): string {
  return line.replace(/^<report>\s*/i, '').replace(/^#+\s*/, '').trim()
}

function normalizeSessionTitle(title: string | undefined, fallback: string): string {
  const lines = String(title || '')
    .split('\n')
    .map((line) => stripMarkdownPrefix(line))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const preferred = lines.find((line) => !/^(执行摘要|summary|摘要)$/i.test(line))
  return preferred || fallback
}

function mapReviewSession(session: ReviewSessionFile): SessionCard {
  return withResumeCommand({
    id: session.id,
    capability: 'review',
    title: 'Repository review',
    status: session.status,
    updatedAt: new Date(session.updatedAt),
    artifactPaths: [],
  })
}

function mapDiscussSession(session: DiscussSessionFile): SessionCard {
  return withResumeCommand({
    id: session.id,
    capability: 'discuss',
    title: normalizeSessionTitle(session.title, 'Discussion'),
    status: session.status,
    updatedAt: new Date(session.updatedAt),
    artifactPaths: [],
  })
}

function mapTrdSession(session: TrdSessionFile): SessionCard {
  return withResumeCommand({
    id: session.id,
    capability: 'trd',
    title: normalizeSessionTitle(session.title || session.prdPath, session.prdPath),
    status: session.stage === 'completed' ? 'completed' : 'paused',
    updatedAt: new Date(session.updatedAt),
    artifactPaths: toArtifactPaths(session.artifacts),
  })
}

function mapLoopSession(session: LoopSessionFile): SessionCard {
  return withResumeCommand({
    id: session.id,
    capability: 'loop',
    title: normalizeSessionTitle(session.title, 'Loop run'),
    status: session.status,
    updatedAt: new Date(session.updatedAt),
    artifactPaths: toArtifactPaths(session.artifacts),
  })
}

async function loadLatestHarnessRoundSummary(roleRoundsDir: string | undefined): Promise<HarnessRoleRoundSummary | null> {
  if (!roleRoundsDir) {
    return null
  }

  try {
    const entries = (await readdir(roleRoundsDir))
      .filter((entry) => /^cycle-\d+\.json$/.test(entry))
      .sort((left, right) => {
        const leftCycle = Number.parseInt(left.match(/\d+/)?.[0] || '0', 10)
        const rightCycle = Number.parseInt(right.match(/\d+/)?.[0] || '0', 10)
        return rightCycle - leftCycle
      })
    const latest = entries[0]
    if (!latest) {
      return null
    }
    return JSON.parse(await readFile(join(roleRoundsDir, latest), 'utf-8')) as HarnessRoleRoundSummary
  } catch {
    return null
  }
}

async function loadHarnessRoundIndex(roleRoundsDir: string | undefined): Promise<HarnessRoundIndexEntry[]> {
  if (!roleRoundsDir) {
    return []
  }

  try {
    const entries = (await readdir(roleRoundsDir))
      .filter((entry) => /^cycle-\d+\.json$/.test(entry))
      .sort((left, right) => {
        const leftCycle = Number.parseInt(left.match(/\d+/)?.[0] || '0', 10)
        const rightCycle = Number.parseInt(right.match(/\d+/)?.[0] || '0', 10)
        return leftCycle - rightCycle
      })

    const rounds = await Promise.all(entries.map(async (entry) => {
      try {
        const cycle = Number.parseInt(entry.match(/\d+/)?.[0] || '0', 10)
        const summary = JSON.parse(await readFile(join(roleRoundsDir, entry), 'utf-8')) as HarnessRoleRoundSummary
        return {
          cycle,
          finalAction: summary.finalAction || 'unknown',
        }
      } catch {
        return null
      }
    }))

    return rounds.filter((round): round is HarnessRoundIndexEntry => round !== null)
  } catch {
    return []
  }
}

async function loadHarnessGraph(graphPath: string | undefined): Promise<HarnessGraphArtifact | null> {
  if (!graphPath) {
    return null
  }

  try {
    return JSON.parse(await readFile(graphPath, 'utf-8')) as HarnessGraphArtifact
  } catch {
    return null
  }
}

function severityWeight(severity: string | undefined): number {
  switch (severity) {
    case 'critical':
      return 4
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
      return 1
    default:
      return 0
  }
}

function buildHarnessReasonSummary(summary: HarnessRoleRoundSummary | null): string | undefined {
  if (!summary) {
    return undefined
  }

  const mostSevereIssue = [...(summary.openIssues || [])]
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))[0]

  let reason: string | undefined

  if (mostSevereIssue?.title) {
    const source = mostSevereIssue.sourceRole || 'reviewer'
    reason = `${source}: ${mostSevereIssue.title}`
  } else {
    const firstReviewSummary = summary.reviewResults?.find((result) => result.summary?.trim())
    if (firstReviewSummary?.summary) {
      reason = `${firstReviewSummary.reviewerRoleId || 'reviewer'}: ${firstReviewSummary.summary.trim()}`
    } else {
      reason = summary.arbitrationResult?.summary?.trim() || undefined
    }
  }

  if (!reason) {
    return undefined
  }

  switch (summary.finalAction) {
    case 'approved':
      return `approved: ${reason}`
    case 'revise':
      return `revise: ${reason}`
    case 'requeue_or_blocked':
      return `blocked: ${reason}`
    default:
      return reason
  }
}

function buildHarnessParticipantSummary(summary: HarnessRoleRoundSummary | null): string | undefined {
  if (!summary?.roles?.length) {
    return undefined
  }

  const roleTypes = summary.roles
    .map((role) => role.roleType)
    .filter((roleType): roleType is NonNullable<typeof roleType> => Boolean(roleType))

  if (roleTypes.length === 0) {
    return undefined
  }

  const reviewerCount = roleTypes.filter((roleType) => roleType === 'reviewer').length
  const parts: string[] = []

  if (roleTypes.includes('developer')) {
    parts.push('dev')
  }
  if (roleTypes.includes('tester')) {
    parts.push('test')
  }
  if (reviewerCount === 1) {
    parts.push('1 reviewer')
  } else if (reviewerCount > 1) {
    parts.push(`${reviewerCount} reviewers`)
  }
  if (roleTypes.includes('arbitrator') && summary.arbitrationResult) {
    parts.push('arbitrator')
  }

  return parts.length > 0 ? parts.join('+') : undefined
}

function buildHarnessNextStepSummary(summary: HarnessRoleRoundSummary | null): string {
  const nextRoundBrief = summary?.nextRoundBrief?.trim()
  if (nextRoundBrief) {
    return nextRoundBrief
  }

  switch (summary?.finalAction) {
    case 'approved':
      return 'No further action.'
    case 'revise':
      return 'Continue the next review cycle.'
    case 'requeue_or_blocked':
      return 'Await human or scheduler intervention.'
    default:
      return 'No next-round brief.'
  }
}

function formatHarnessParticipantList(summary: HarnessRoleRoundSummary | null): string | undefined {
  if (!summary?.roles?.length) {
    return undefined
  }

  const roleTypes = summary.roles
    .map((role) => role.roleType)
    .filter((roleType): roleType is NonNullable<typeof roleType> => Boolean(roleType))

  if (roleTypes.length === 0) {
    return undefined
  }

  const reviewerCount = roleTypes.filter((roleType) => roleType === 'reviewer').length
  const parts: string[] = []

  if (roleTypes.includes('developer')) {
    parts.push('developer')
  }
  if (roleTypes.includes('tester')) {
    parts.push('tester')
  }
  if (reviewerCount === 1) {
    parts.push('1 reviewer')
  } else if (reviewerCount > 1) {
    parts.push(`${reviewerCount} reviewers`)
  }
  if (roleTypes.includes('arbitrator') && summary.arbitrationResult) {
    parts.push('arbitrator')
  }

  return parts.length > 0 ? parts.join(', ') : undefined
}

function buildHarnessReviewerDetailLines(summary: HarnessRoleRoundSummary | null): string[] {
  if (!summary?.reviewResults?.length) {
    return []
  }

  const roleNameById = new Map(
    (summary.roles || [])
      .filter((role) => role.roleId)
      .map((role) => [role.roleId as string, role.displayName || role.roleId || 'reviewer'])
  )

  return summary.reviewResults
    .filter((result) => result.reviewerRoleId)
    .map((result) => {
      const label = roleNameById.get(result.reviewerRoleId as string) || result.reviewerRoleId || 'reviewer'
      const verdict = result.passed ? 'pass' : 'revise'
      const reason = result.summary?.trim()

      return reason
        ? `${label}: ${verdict} - ${reason}`
        : `${label}: ${verdict}`
    })
}

function buildHarnessSelectedDetail(summary: HarnessRoleRoundSummary | null): SessionCard['selectedDetail'] | undefined {
  if (!summary) {
    return undefined
  }

  const reviewerSummaries = buildHarnessReviewerDetailLines(summary)
  const arbitrationSummary = summary.arbitrationResult
    ? `Decision: ${summary.finalAction || summary.arbitrationResult.action || 'unknown'} - ${summary.arbitrationResult.summary?.trim() || 'No final summary.'}`
    : undefined
  const nextStep = buildHarnessNextStepSummary(summary)
  const participants = formatHarnessParticipantList(summary)

  if (!participants && reviewerSummaries.length === 0 && !arbitrationSummary && !nextStep) {
    return undefined
  }

  return {
    participants,
    reviewerSummaries,
    arbitration: arbitrationSummary,
    nextStep,
  }
}

function summarizeReadyNodes(nodes: HarnessGraphNode[]): string {
  const readyNodes = nodes.filter((node) => node.state === 'ready').map((node) => node.id)
  return readyNodes.length > 0
    ? readyNodes.join(', ')
    : 'No nodes are ready right now.'
}

function simulateApprovalTargets(
  graph: HarnessGraphArtifact,
  currentReadyNodeIds: Set<string>,
  target: { nodeId?: string; gate: HarnessGraphApprovalGate }
): string[] {
  try {
    const updated = recordHarnessGraphApprovalDecision(graph, {
      decision: 'approved',
      ...(target.nodeId ? { nodeId: target.nodeId } : {}),
      gateId: target.gate.gateId,
    })
    return updated.nodes
      .filter((node) => node.state === 'ready' && !currentReadyNodeIds.has(node.id))
      .map((node) => node.id)
  } catch {
    return []
  }
}

function buildApprovalRecommendation(
  graph: HarnessGraphArtifact,
  sessionId: string,
  currentReadyNodeIds: Set<string>
): { action: string; command: string } | null {
  const candidates: Array<{
    nodeId?: string
    gate: HarnessGraphApprovalGate
    unlockedNodeIds: string[]
  }> = []

  for (const gate of graph.approvalGates.filter((entry) => entry.status === 'pending')) {
    candidates.push({
      gate,
      unlockedNodeIds: simulateApprovalTargets(graph, currentReadyNodeIds, { gate }),
    })
  }

  for (const node of graph.nodes) {
    for (const gate of node.approvalGates.filter((entry) => entry.status === 'pending')) {
      candidates.push({
        nodeId: node.id,
        gate,
        unlockedNodeIds: simulateApprovalTargets(graph, currentReadyNodeIds, { nodeId: node.id, gate }),
      })
    }
  }

  candidates.sort((left, right) => {
    const unlockDelta = right.unlockedNodeIds.length - left.unlockedNodeIds.length
    if (unlockDelta !== 0) {
      return unlockDelta
    }
    const leftScope = left.nodeId ? 1 : 0
    const rightScope = right.nodeId ? 1 : 0
    if (leftScope !== rightScope) {
      return rightScope - leftScope
    }
    const leftLabel = `${left.nodeId || 'graph'}:${left.gate.gateId}`
    const rightLabel = `${right.nodeId || 'graph'}:${right.gate.gateId}`
    return leftLabel.localeCompare(rightLabel)
  })

  const best = candidates[0]
  if (!best) {
    return null
  }

  const targetLabel = best.nodeId || 'graph'
  const unlockLabel = best.unlockedNodeIds.length > 0 ? best.unlockedNodeIds.join(', ') : 'no immediate runnable node'
  const argv = [
    'harness',
    'approve',
    sessionId,
    ...(best.nodeId ? ['--node', best.nodeId] : []),
    '--gate',
    best.gate.gateId,
  ]

  return {
    action: `Recommend approving ${targetLabel} first. Immediate unlock: ${unlockLabel}.`,
    command: buildCommandDisplay(argv),
  }
}

function buildHarnessGraphInsight(graph: HarnessGraphArtifact | null, sessionId: string): HarnessGraphInsight | undefined {
  if (!graph) {
    return undefined
  }

  const currentReadyNodeIds = new Set(graph.nodes.filter((node) => node.state === 'ready').map((node) => node.id))
  const attention: string[] = []

  for (const gate of graph.approvalGates.filter((entry) => entry.status === 'pending')) {
    attention.push(
      `Approval needed: graph - ${gate.label}. After approval: ${simulateApprovalTargets(graph, currentReadyNodeIds, { gate })}`
    )
  }

  for (const node of graph.nodes) {
    for (const gate of node.approvalGates.filter((entry) => entry.status === 'pending')) {
      attention.push(
        `Approval needed: ${node.id} - ${gate.label}. ${node.statusReason || 'Waiting for approval.'} After approval: ${simulateApprovalTargets(graph, currentReadyNodeIds, { nodeId: node.id, gate })}`
      )
    }
  }

  for (const node of graph.nodes.filter((entry) => entry.state === 'blocked' && entry.statusReason)) {
    attention.push(`Blocked: ${node.id} - ${node.statusReason}`)
  }

  const detailSummary = `graph ready=${graph.rollup.ready} waiting=${graph.rollup.waitingApproval} blocked=${graph.rollup.blocked}`
  const recommendation = buildApprovalRecommendation(graph, sessionId, currentReadyNodeIds)

  return {
    detailSummary,
    selectedDetail: {
      graphSummary: `${graph.graphId} · ${graph.status} · ready ${graph.rollup.ready} · waiting approval ${graph.rollup.waitingApproval} · blocked ${graph.rollup.blocked}`,
      attention,
      readyNow: summarizeReadyNodes(graph.nodes),
      ...(recommendation ? {
        recommendedAction: recommendation.action,
        recommendedCommand: recommendation.command,
      } : {}),
    },
  }
}

async function mapWorkflowSession(session: WorkflowSessionFile): Promise<SessionCard> {
  const latestHarnessRound = session.capability === 'harness'
    ? await loadLatestHarnessRoundSummary(session.artifacts?.roleRoundsDir)
    : null
  const harnessRoundIndex = session.capability === 'harness'
    ? await loadHarnessRoundIndex(session.artifacts?.roleRoundsDir)
    : []
  const harnessGraph = session.capability === 'harness'
    ? await loadHarnessGraph(session.artifacts?.graphPath)
    : null
  const graphInsight = session.capability === 'harness'
    ? buildHarnessGraphInsight(harnessGraph, session.id)
    : undefined
  const harnessSummary = session.capability === 'harness'
    ? buildHarnessSelectedDetail(latestHarnessRound)
    : undefined

  return withResumeCommand({
    id: session.id,
    capability: session.capability,
    title: normalizeSessionTitle(session.title, session.capability),
    ...(session.capability === 'harness' && session.artifacts?.graphPath ? { graphPath: session.artifacts.graphPath } : {}),
    detail: latestHarnessRound
      ? [
        session.currentStage || session.status,
        harnessRoundIndex.map((round) => `${round.cycle}=${round.finalAction}`).join(', ') || latestHarnessRound.finalAction || 'unknown',
        buildHarnessParticipantSummary(latestHarnessRound),
        buildHarnessReasonSummary(latestHarnessRound),
        graphInsight?.detailSummary,
        buildHarnessNextStepSummary(latestHarnessRound),
      ].filter((part): part is string => Boolean(part && part.trim())).join(' · ')
      : graphInsight?.detailSummary
        ? [
          session.currentStage || session.status,
          graphInsight.detailSummary,
          session.summary,
        ].filter((part): part is string => Boolean(part && part.trim())).join(' · ')
      : undefined,
    selectedDetail: session.capability === 'harness'
      ? {
        reviewerSummaries: harnessSummary?.reviewerSummaries || [],
        ...(harnessSummary?.participants ? { participants: harnessSummary.participants } : {}),
        ...(harnessSummary?.arbitration ? { arbitration: harnessSummary.arbitration } : {}),
        ...(harnessSummary?.nextStep ? { nextStep: harnessSummary.nextStep } : {}),
        ...(graphInsight?.selectedDetail?.graphSummary ? { graphSummary: graphInsight.selectedDetail.graphSummary } : {}),
        ...(graphInsight?.selectedDetail?.attention ? { attention: graphInsight.selectedDetail.attention } : {}),
        ...(graphInsight?.selectedDetail?.readyNow ? { readyNow: graphInsight.selectedDetail.readyNow } : {}),
        ...(graphInsight?.selectedDetail?.recommendedAction ? { recommendedAction: graphInsight.selectedDetail.recommendedAction } : {}),
        ...(graphInsight?.selectedDetail?.recommendedCommand ? { recommendedCommand: graphInsight.selectedDetail.recommendedCommand } : {}),
      }
      : undefined,
    status: session.status,
    updatedAt: new Date(session.updatedAt),
    artifactPaths: toArtifactPaths(session.artifacts),
  })
}

function groupCards(cards: SessionCard[]): DashboardSessions {
  return {
    continue: cards.filter(isContinuable),
    recent: cards.filter((card) => !isContinuable(card)),
  }
}

export async function loadSessionDashboard(options: SessionDashboardOptions): Promise<DashboardSessions> {
  const magpieHomeDir = options.magpieHomeDir || getMagpieHomeDir()
  const repoMagpieDir = getRepoMagpieDir(options.cwd)
  const sessionsDir = getRepoSessionsDir(options.cwd)
  const reviewDir = sessionsDir
  const discussDir = join(magpieHomeDir, 'discussions')
  const trdDir = join(sessionsDir, 'trd')
  const loopDir = join(sessionsDir, 'loop')

  const [reviewSessions, discussSessions, trdSessions, loopSessions, workflowSessions] = await Promise.all([
    readJsonFiles<ReviewSessionFile>(reviewDir),
    readJsonFiles<DiscussSessionFile>(discussDir),
    loadSessionJsonCards<TrdSessionFile>(trdDir),
    loadSessionJsonCards<LoopSessionFile>(loopDir),
    loadWorkflowSessions(repoMagpieDir),
  ])
  const workflowCards = await Promise.all(workflowSessions.map(mapWorkflowSession))

  const cards = [
    ...reviewSessions.map(mapReviewSession),
    ...discussSessions.map(mapDiscussSession),
    ...trdSessions.map(mapTrdSession),
    ...loopSessions.map(mapLoopSession),
    ...workflowCards,
  ].sort(sortByUpdatedAtDesc)

  return groupCards(cards)
}

export async function loadDashboardSessions(cwd: string): Promise<DashboardSessions> {
  return loadSessionDashboard({ cwd })
}

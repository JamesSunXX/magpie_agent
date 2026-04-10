import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'
import { buildResumeArgv } from './command-builder.js'
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
  updatedAt: string
  artifacts?: Record<string, string>
}

interface SessionDashboardOptions {
  cwd: string
  magpieHomeDir?: string
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

async function loadWorkflowSessions(magpieHomeDir: string): Promise<WorkflowSessionFile[]> {
  const baseDir = join(magpieHomeDir, 'workflow-sessions')
  const sessions: WorkflowSessionFile[] = []

  try {
    const capabilityDirs = await readdir(baseDir)
    for (const capability of capabilityDirs) {
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

function mapWorkflowSession(session: WorkflowSessionFile): SessionCard {
  return withResumeCommand({
    id: session.id,
    capability: session.capability,
    title: normalizeSessionTitle(session.title, session.capability),
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
  const reviewDir = join(options.cwd, '.magpie', 'sessions')
  const discussDir = join(magpieHomeDir, 'discussions')
  const trdDir = join(magpieHomeDir, 'trd-sessions')
  const loopDir = join(magpieHomeDir, 'loop-sessions')

  const [reviewSessions, discussSessions, trdSessions, loopSessions, workflowSessions] = await Promise.all([
    readJsonFiles<ReviewSessionFile>(reviewDir),
    readJsonFiles<DiscussSessionFile>(discussDir),
    readJsonFiles<TrdSessionFile>(trdDir),
    readJsonFiles<LoopSessionFile>(loopDir),
    loadWorkflowSessions(magpieHomeDir),
  ])

  const cards = [
    ...reviewSessions.map(mapReviewSession),
    ...discussSessions.map(mapDiscussSession),
    ...trdSessions.map(mapTrdSession),
    ...loopSessions.map(mapLoopSession),
    ...workflowSessions.map(mapWorkflowSession),
  ].sort(sortByUpdatedAtDesc)

  return groupCards(cards)
}

export async function loadDashboardSessions(cwd: string): Promise<DashboardSessions> {
  return loadSessionDashboard({ cwd })
}

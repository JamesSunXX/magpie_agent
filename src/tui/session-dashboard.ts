import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'
import { buildResumeArgv } from './command-builder.js'
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
    const results = await Promise.all(entries.filter((entry) => entry.endsWith('.json')).map(async (entry) => {
      const filePath = join(dir, entry)
      return JSON.parse(await readFile(filePath, 'utf-8')) as T
    }))
    return results
  } catch {
    return []
  }
}

async function loadWorkflowSessions(magpieHomeDir: string): Promise<SessionCard[]> {
  const baseDir = join(magpieHomeDir, 'workflow-sessions')
  const cards: SessionCard[] = []

  try {
    const capabilityDirs = await readdir(baseDir)
    for (const capability of capabilityDirs) {
      const capabilityDir = join(baseDir, capability)
      const sessionDirs = await readdir(capabilityDir)

      for (const sessionDir of sessionDirs) {
        const filePath = join(capabilityDir, sessionDir, 'session.json')

        try {
          const raw = JSON.parse(await readFile(filePath, 'utf-8')) as WorkflowSessionFile
          cards.push({
            id: raw.id,
            capability: raw.capability,
            title: raw.title,
            status: raw.status,
            updatedAt: new Date(raw.updatedAt),
            artifactPaths: toArtifactPaths(raw.artifacts),
          })
        } catch {
          // Ignore malformed workflow sessions.
        }
      }
    }
  } catch {
    return []
  }

  return cards
}

function isContinuable(card: SessionCard): boolean {
  return ['planning', 'paused', 'in_progress', 'active', 'running', 'paused_for_human'].includes(card.status)
}

function withResumeCommand(card: SessionCard): SessionCard {
  return {
    ...card,
    resumeCommand: buildResumeArgv(card),
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
    ...reviewSessions.map((session) => withResumeCommand({
      id: session.id,
      capability: 'review',
      title: 'Repository review',
      status: session.status,
      updatedAt: new Date(session.updatedAt),
      artifactPaths: [],
    })),
    ...discussSessions.map((session) => withResumeCommand({
      id: session.id,
      capability: 'discuss',
      title: session.title,
      status: session.status,
      updatedAt: new Date(session.updatedAt),
      artifactPaths: [],
    })),
    ...trdSessions.map((session) => withResumeCommand({
      id: session.id,
      capability: 'trd',
      title: session.title || session.prdPath,
      status: session.stage === 'completed' ? 'completed' : 'paused',
      updatedAt: new Date(session.updatedAt),
      artifactPaths: toArtifactPaths(session.artifacts),
    })),
    ...loopSessions.map((session) => withResumeCommand({
      id: session.id,
      capability: 'loop',
      title: session.title,
      status: session.status,
      updatedAt: new Date(session.updatedAt),
      artifactPaths: toArtifactPaths(session.artifacts),
    })),
    ...workflowSessions,
  ].sort(sortByUpdatedAtDesc)

  return {
    continue: cards.filter(isContinuable),
    recent: cards.filter((card) => !isContinuable(card)),
  }
}

export async function loadDashboardSessions(cwd: string): Promise<DashboardSessions> {
  return loadSessionDashboard({ cwd })
}

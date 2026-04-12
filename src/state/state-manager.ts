// src/state/state-manager.ts
import { mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { getMagpieHomeDir, getRepoCapabilitySessionsDir, getRepoSessionFile } from '../platform/paths.js'
import type { ReviewSession, FeatureAnalysis, DiscussSession, TrdSession, LoopSession } from './types.js'

async function mergePersistedLoopArtifacts(filePath: string, session: LoopSession): Promise<LoopSession> {
  try {
    const existingRaw = await readFile(filePath, 'utf-8')
    const existing = JSON.parse(existingRaw) as { artifacts?: Record<string, string> }
    session.artifacts = {
      ...(existing.artifacts || {}),
      ...session.artifacts,
    }
  } catch {
    // Nothing persisted yet, so there is nothing to merge.
  }

  return session
}

export class StateManager {
  private baseDir: string
  private magpieDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    this.magpieDir = join(baseDir, '.magpie')
  }

  async init(): Promise<void> {
    await mkdir(join(this.magpieDir, 'sessions'), { recursive: true })
    await mkdir(join(this.magpieDir, 'cache'), { recursive: true })
  }

  async saveSession(session: ReviewSession): Promise<void> {
    const sessionsDir = join(this.magpieDir, 'sessions')
    await mkdir(sessionsDir, { recursive: true })
    const filePath = join(sessionsDir, `${session.id}.json`)
    await writeFile(filePath, JSON.stringify(session, null, 2))
  }

  async loadSession(id: string): Promise<ReviewSession | null> {
    const filePath = join(this.magpieDir, 'sessions', `${id}.json`)
    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      // Convert date strings back to Date objects
      data.startedAt = new Date(data.startedAt)
      data.updatedAt = new Date(data.updatedAt)
      return data as ReviewSession
    } catch {
      return null
    }
  }

  async findIncompleteSessions(): Promise<ReviewSession[]> {
    const sessionsDir = join(this.magpieDir, 'sessions')
    try {
      const files = await readdir(sessionsDir)
      const sessions: ReviewSession[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '')
          const session = await this.loadSession(id)
          if (session && (session.status === 'in_progress' || session.status === 'paused')) {
            sessions.push(session)
          }
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return sessions
    } catch {
      return []
    }
  }

  async listAllSessions(): Promise<ReviewSession[]> {
    const sessionsDir = join(this.magpieDir, 'sessions')
    try {
      const files = await readdir(sessionsDir)
      const sessions: ReviewSession[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '')
          const session = await this.loadSession(id)
          if (session) {
            sessions.push(session)
          }
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return sessions
    } catch {
      return []
    }
  }

  async saveFeatureAnalysis(analysis: FeatureAnalysis): Promise<void> {
    const cacheDir = join(this.magpieDir, 'cache')
    await mkdir(cacheDir, { recursive: true })
    const filePath = join(cacheDir, 'feature-analysis.json')
    await writeFile(filePath, JSON.stringify(analysis, null, 2))
  }

  async loadFeatureAnalysis(): Promise<FeatureAnalysis | null> {
    const filePath = join(this.magpieDir, 'cache', 'feature-analysis.json')
    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      data.analyzedAt = new Date(data.analyzedAt)
      return data as FeatureAnalysis
    } catch {
      return null
    }
  }

  // Discuss session methods — stored in ~/.magpie/discussions/
  private get discussionsDir(): string {
    return join(getMagpieHomeDir(), 'discussions')
  }

  async initDiscussions(): Promise<void> {
    await mkdir(this.discussionsDir, { recursive: true })
  }

  async saveDiscussSession(session: DiscussSession): Promise<void> {
    await mkdir(this.discussionsDir, { recursive: true })
    const filePath = join(this.discussionsDir, `${session.id}.json`)
    await writeFile(filePath, JSON.stringify(session, null, 2))
  }

  async loadDiscussSession(id: string): Promise<DiscussSession | null> {
    const filePath = join(this.discussionsDir, `${id}.json`)
    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      data.createdAt = new Date(data.createdAt)
      data.updatedAt = new Date(data.updatedAt)
      for (const round of data.rounds) {
        round.timestamp = new Date(round.timestamp)
        for (const msg of round.messages) {
          msg.timestamp = new Date(msg.timestamp)
        }
      }
      return data as DiscussSession
    } catch {
      return null
    }
  }

  async listDiscussSessions(): Promise<DiscussSession[]> {
    try {
      const files = await readdir(this.discussionsDir)
      const sessions: DiscussSession[] = []
      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '')
          const session = await this.loadDiscussSession(id)
          if (session) sessions.push(session)
        }
      }
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return sessions
    } catch {
      return []
    }
  }

  // TRD session methods — stored in <repo>/.magpie/sessions/trd/<id>/session.json
  private get trdSessionsDir(): string {
    return getRepoCapabilitySessionsDir(this.baseDir, 'trd')
  }

  async initTrdSessions(): Promise<void> {
    await mkdir(this.trdSessionsDir, { recursive: true })
  }

  async saveTrdSession(session: TrdSession): Promise<void> {
    const filePath = getRepoSessionFile(this.baseDir, 'trd', session.id)
    await mkdir(join(this.trdSessionsDir, session.id), { recursive: true })
    await writeFile(filePath, JSON.stringify(session, null, 2))
  }

  async loadTrdSession(id: string): Promise<TrdSession | null> {
    const filePath = getRepoSessionFile(this.baseDir, 'trd', id)
    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      data.createdAt = new Date(data.createdAt)
      data.updatedAt = new Date(data.updatedAt)
      data.rounds = (data.rounds || []).map((r: Record<string, unknown>) => ({
        ...r,
        timestamp: new Date(r.timestamp as string),
      }))
      return data as TrdSession
    } catch {
      return null
    }
  }

  async listTrdSessions(): Promise<TrdSession[]> {
    try {
      const entries = await readdir(this.trdSessionsDir)
      const sessions: TrdSession[] = []
      for (const id of entries) {
        const session = await this.loadTrdSession(id)
        if (session) sessions.push(session)
      }
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return sessions
    } catch {
      return []
    }
  }

  // Loop session methods — stored in <repo>/.magpie/sessions/loop/<id>/session.json
  private get loopSessionsDir(): string {
    return getRepoCapabilitySessionsDir(this.baseDir, 'loop')
  }

  async initLoopSessions(): Promise<void> {
    await mkdir(this.loopSessionsDir, { recursive: true })
  }

  async saveLoopSession(session: LoopSession): Promise<void> {
    const filePath = getRepoSessionFile(this.baseDir, 'loop', session.id)
    await mkdir(join(this.loopSessionsDir, session.id), { recursive: true })
    const mergedSession = await mergePersistedLoopArtifacts(filePath, session)
    await writeFile(filePath, JSON.stringify(mergedSession, null, 2))
  }

  async loadLoopSession(id: string): Promise<LoopSession | null> {
    const filePath = getRepoSessionFile(this.baseDir, 'loop', id)
    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      data.createdAt = new Date(data.createdAt)
      data.updatedAt = new Date(data.updatedAt)
      data.stageResults = (data.stageResults || []).map((s: Record<string, unknown>) => ({
        ...s,
        timestamp: new Date(s.timestamp as string),
      }))
      data.humanConfirmations = (data.humanConfirmations || []).map((item: Record<string, unknown>) => ({
        ...item,
        createdAt: new Date(item.createdAt as string),
        updatedAt: new Date(item.updatedAt as string),
      }))
      return data as LoopSession
    } catch {
      return null
    }
  }

  async listLoopSessions(): Promise<LoopSession[]> {
    try {
      const entries = await readdir(this.loopSessionsDir)
      const sessions: LoopSession[] = []
      for (const id of entries) {
        const session = await this.loadLoopSession(id)
        if (session) sessions.push(session)
      }
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return sessions
    } catch {
      return []
    }
  }
}

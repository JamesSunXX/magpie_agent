import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getRepoMagpieDir } from '../../paths.js'
import type { ImServerStatus } from './types.js'

function processedEventsPath(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'im', 'processed-events.json')
}

function serverStatusPath(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'im', 'server-state.json')
}

async function loadProcessedEventIds(cwd: string): Promise<string[]> {
  try {
    const raw = await readFile(processedEventsPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

async function saveProcessedEventIds(cwd: string, ids: string[]): Promise<void> {
  const path = processedEventsPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(ids, null, 2), 'utf-8')
}

export function createImRuntime(cwd: string) {
  return {
    async hasProcessedEvent(eventId: string): Promise<boolean> {
      const existing = await loadProcessedEventIds(cwd)
      return existing.includes(eventId)
    },

    async markEventProcessed(eventId: string): Promise<boolean> {
      const existing = await loadProcessedEventIds(cwd)
      if (existing.includes(eventId)) {
        return false
      }

      existing.push(eventId)
      await saveProcessedEventIds(cwd, existing.slice(-200))
      return true
    },
  }
}

export async function saveImServerStatus(cwd: string, status: ImServerStatus): Promise<void> {
  const path = serverStatusPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(status, null, 2), 'utf-8')
}

export async function loadImServerStatus(cwd: string): Promise<ImServerStatus | null> {
  try {
    const raw = await readFile(serverStatusPath(cwd), 'utf-8')
    return JSON.parse(raw) as ImServerStatus
  } catch {
    return null
  }
}

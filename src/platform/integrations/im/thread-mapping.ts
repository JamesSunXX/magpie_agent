import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getRepoMagpieDir } from '../../paths.js'

export interface ThreadMappingRecord {
  threadId: string
  rootMessageId: string
  chatId: string
  capability: 'loop' | 'harness'
  sessionId: string
  status: string
  lastEventId?: string
  createdAt: string
  updatedAt: string
}

function mappingPath(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'im', 'thread-mappings.json')
}

async function loadThreadMappings(cwd: string): Promise<ThreadMappingRecord[]> {
  try {
    const raw = await readFile(mappingPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as ThreadMappingRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveThreadMappings(cwd: string, records: ThreadMappingRecord[]): Promise<void> {
  const path = mappingPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(records, null, 2), 'utf-8')
}

export async function saveThreadMapping(
  cwd: string,
  input: Omit<ThreadMappingRecord, 'createdAt' | 'updatedAt'> & Partial<Pick<ThreadMappingRecord, 'createdAt' | 'updatedAt'>>
): Promise<ThreadMappingRecord> {
  const records = await loadThreadMappings(cwd)
  const now = new Date().toISOString()
  const existingIndex = records.findIndex((record) =>
    record.capability === input.capability && record.sessionId === input.sessionId
  )

  const record: ThreadMappingRecord = {
    ...input,
    createdAt: input.createdAt || records[existingIndex]?.createdAt || now,
    updatedAt: input.updatedAt || now,
  }

  if (existingIndex >= 0) {
    records[existingIndex] = record
  } else {
    records.push(record)
  }

  await saveThreadMappings(cwd, records)
  return record
}

export async function loadThreadMappingBySession(
  cwd: string,
  capability: ThreadMappingRecord['capability'],
  sessionId: string
): Promise<ThreadMappingRecord | null> {
  const records = await loadThreadMappings(cwd)
  return records.find((record) => record.capability === capability && record.sessionId === sessionId) || null
}

export async function loadThreadMappingByThread(cwd: string, threadId: string): Promise<ThreadMappingRecord | null> {
  const records = await loadThreadMappings(cwd)
  return records.find((record) => record.threadId === threadId) || null
}

import { closeSync, openSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { FailureIndex, FailureIndexEntry, FailureRecord } from './types.js'

function defaultFailureIndex(): FailureIndex {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  }
}

function uniqRecent(values: Array<string | undefined>, maxItems = 3): string[] {
  const deduped = values.filter((value): value is string => Boolean(value))
    .reverse()
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .reverse()
  return deduped.slice(-maxItems)
}

function mergeEntry(entry: FailureIndexEntry | undefined, record: FailureRecord): FailureIndexEntry {
  const now = record.timestamp
  const base: FailureIndexEntry = entry || {
    signature: record.signature,
    category: record.category,
    categories: [record.category],
    count: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    recentSessionIds: [],
    capabilities: {},
    latestReason: record.reason,
    latestEvidencePaths: [],
    recentEvidencePaths: [],
    selfHealCandidateCount: 0,
    candidateForSelfRepair: false,
  }

  return {
    ...base,
    category: record.category,
    categories: uniqRecent([...base.categories, record.category], 6) as FailureIndexEntry['categories'],
    count: base.count + 1,
    firstSeenAt: base.firstSeenAt || now,
    lastSeenAt: now,
    lastSessionId: record.sessionId,
    recentSessionIds: uniqRecent([...base.recentSessionIds, record.sessionId]),
    capabilities: {
      ...base.capabilities,
      [record.capability]: (base.capabilities[record.capability] || 0) + 1,
    },
    latestReason: record.reason,
    latestEvidencePaths: [...record.evidencePaths],
    recentEvidencePaths: uniqRecent([...base.recentEvidencePaths, ...record.evidencePaths]),
    selfHealCandidateCount: base.selfHealCandidateCount + (record.selfHealCandidate ? 1 : 0),
    candidateForSelfRepair: base.candidateForSelfRepair || record.selfHealCandidate,
    lastRecoveryAction: record.recoveryAction || base.lastRecoveryAction,
  }
}

async function withIndexLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        return await work()
      } finally {
        closeSync(fd)
        await rm(lockPath, { force: true })
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error
      }
      if (Date.now() - startedAt > 5_000) {
        throw new Error(`Timed out waiting for failure index lock: ${lockPath}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

export async function readFailureIndex(repoRoot: string): Promise<FailureIndex> {
  const indexPath = join(repoRoot, '.magpie', 'failure-index.json')
  try {
    const raw = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(raw) as FailureIndex
    return parsed && Array.isArray(parsed.entries)
      ? parsed
      : defaultFailureIndex()
  } catch {
    return defaultFailureIndex()
  }
}

export async function getFailureOccurrenceCount(repoRoot: string, signature: string): Promise<number> {
  const index = await readFailureIndex(repoRoot)
  return index.entries.find((entry) => entry.signature === signature)?.count || 0
}

export async function appendFailureRecord(input: {
  repoRoot: string
  record: FailureRecord
  sessionDir?: string
  serverFailureDir?: string
}): Promise<{ recordPath: string; indexPath: string; index: FailureIndex }> {
  const magpieDir = join(input.repoRoot, '.magpie')
  const recordDir = input.sessionDir
    ? join(input.sessionDir, 'failures')
    : input.serverFailureDir || join(magpieDir, 'harness-server', 'failures')
  const recordPath = join(recordDir, `${input.record.id}.json`)
  const indexPath = join(magpieDir, 'failure-index.json')
  const lockPath = join(magpieDir, 'failure-index.lock')

  await mkdir(recordDir, { recursive: true })
  await mkdir(magpieDir, { recursive: true })
  await writeFile(recordPath, `${JSON.stringify(input.record, null, 2)}\n`, 'utf-8')

  const index = await withIndexLock(lockPath, async () => {
    const current = await readFailureIndex(input.repoRoot)
    const next: FailureIndex = {
      ...current,
      version: 1,
      updatedAt: input.record.timestamp,
      entries: [...current.entries],
    }
    const existingIndex = next.entries.findIndex((entry) => entry.signature === input.record.signature)
    const merged = mergeEntry(existingIndex >= 0 ? next.entries[existingIndex] : undefined, input.record)
    if (existingIndex >= 0) {
      next.entries[existingIndex] = merged
    } else {
      next.entries.push(merged)
    }
    const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
    await rename(tempPath, indexPath)
    return next
  })

  return {
    recordPath,
    indexPath,
    index,
  }
}

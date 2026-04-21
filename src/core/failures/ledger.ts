import { closeSync, openSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { normalizeFailureSignature } from './classifier.js'
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

function sumCapabilities(
  left: FailureIndexEntry['capabilities'],
  right: FailureIndexEntry['capabilities']
): FailureIndexEntry['capabilities'] {
  const summed: FailureIndexEntry['capabilities'] = { ...left }
  for (const [capability, count] of Object.entries(right)) {
    if (!count) {
      continue
    }
    summed[capability as keyof FailureIndexEntry['capabilities']] =
      (summed[capability as keyof FailureIndexEntry['capabilities']] || 0) + count
  }
  return summed
}

function coerceFailureIndexEntry(entry: FailureIndexEntry): FailureIndexEntry {
  return {
    ...entry,
    signature: normalizeFailureSignature(entry.signature),
    categories: uniqRecent([...(Array.isArray(entry.categories) ? entry.categories : []), entry.category], 6) as FailureIndexEntry['categories'],
    recentSessionIds: Array.isArray(entry.recentSessionIds) ? entry.recentSessionIds : [],
    capabilities: entry.capabilities || {},
    latestEvidencePaths: Array.isArray(entry.latestEvidencePaths) ? entry.latestEvidencePaths : [],
    recentEvidencePaths: Array.isArray(entry.recentEvidencePaths) ? entry.recentEvidencePaths : [],
    selfHealCandidateCount: entry.selfHealCandidateCount || 0,
    candidateForSelfRepair: entry.candidateForSelfRepair || (entry.selfHealCandidateCount || 0) > 0,
  }
}

function mergeIndexEntries(base: FailureIndexEntry, incoming: FailureIndexEntry): FailureIndexEntry {
  const latest = base.lastSeenAt >= incoming.lastSeenAt ? base : incoming

  return {
    ...latest,
    signature: normalizeFailureSignature(base.signature),
    category: latest.category,
    categories: uniqRecent([...(base.categories || [base.category]), ...(incoming.categories || [incoming.category])], 6) as FailureIndexEntry['categories'],
    count: (base.count || 0) + (incoming.count || 0),
    firstSeenAt: base.firstSeenAt <= incoming.firstSeenAt ? base.firstSeenAt : incoming.firstSeenAt,
    lastSeenAt: latest.lastSeenAt,
    lastSessionId: latest.lastSessionId,
    recentSessionIds: uniqRecent([
      ...(base.recentSessionIds || []),
      ...(incoming.recentSessionIds || []),
      base.lastSessionId,
      incoming.lastSessionId,
    ]),
    capabilities: sumCapabilities(base.capabilities || {}, incoming.capabilities || {}),
    latestReason: latest.latestReason,
    latestRecordPath: latest.latestRecordPath || base.latestRecordPath || incoming.latestRecordPath,
    latestEvidencePaths: latest.latestEvidencePaths || [],
    recentEvidencePaths: uniqRecent([
      ...(base.recentEvidencePaths || []),
      ...(base.latestEvidencePaths || []),
      ...(incoming.recentEvidencePaths || []),
      ...(incoming.latestEvidencePaths || []),
    ]),
    selfHealCandidateCount: (base.selfHealCandidateCount || 0) + (incoming.selfHealCandidateCount || 0),
    candidateForSelfRepair: Boolean(
      base.candidateForSelfRepair
      || incoming.candidateForSelfRepair
      || (base.selfHealCandidateCount || 0) > 0
      || (incoming.selfHealCandidateCount || 0) > 0
    ),
    lastRecoveryAction: latest.lastRecoveryAction || base.lastRecoveryAction || incoming.lastRecoveryAction,
  }
}

function normalizeFailureIndexEntries(entries: FailureIndexEntry[]): FailureIndexEntry[] {
  const merged = new Map<string, FailureIndexEntry>()

  for (const rawEntry of entries) {
    const entry = coerceFailureIndexEntry(rawEntry)
    const existing = merged.get(entry.signature)
    merged.set(entry.signature, existing ? mergeIndexEntries(existing, entry) : entry)
  }

  return [...merged.values()]
}

function normalizeFailureRecord(record: FailureRecord): FailureRecord {
  const metadata = { ...(record.metadata || {}) }
  if (typeof metadata.sourceFailureSignature === 'string') {
    metadata.sourceFailureSignature = normalizeFailureSignature(metadata.sourceFailureSignature)
  }

  return {
    ...record,
    signature: normalizeFailureSignature(record.signature),
    metadata,
  }
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

function countsTowardFailureIndex(record: FailureRecord): boolean {
  return record.metadata.countTowardFailureIndex !== false
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
      ? {
        ...parsed,
        entries: normalizeFailureIndexEntries(parsed.entries),
      }
      : defaultFailureIndex()
  } catch {
    return defaultFailureIndex()
  }
}

export async function getFailureOccurrenceCount(repoRoot: string, signature: string): Promise<number> {
  const index = await readFailureIndex(repoRoot)
  const normalizedSignature = normalizeFailureSignature(signature)
  return index.entries.find((entry) => entry.signature === normalizedSignature)?.count || 0
}

export async function appendFailureRecord(input: {
  repoRoot: string
  record: FailureRecord
  sessionDir?: string
  serverFailureDir?: string
}): Promise<{ recordPath: string; indexPath: string; index: FailureIndex }> {
  const normalizedRecord = normalizeFailureRecord(input.record)
  const magpieDir = join(input.repoRoot, '.magpie')
  const recordDir = input.sessionDir
    ? join(input.sessionDir, 'failures')
    : input.serverFailureDir || join(magpieDir, 'harness-server', 'failures')
  const recordPath = join(recordDir, `${normalizedRecord.id}.json`)
  const indexPath = join(magpieDir, 'failure-index.json')
  const lockPath = join(magpieDir, 'failure-index.lock')

  await mkdir(recordDir, { recursive: true })
  await mkdir(magpieDir, { recursive: true })
  await writeFile(recordPath, `${JSON.stringify(normalizedRecord, null, 2)}\n`, 'utf-8')

  if (!countsTowardFailureIndex(normalizedRecord)) {
    return {
      recordPath,
      indexPath,
      index: await readFailureIndex(input.repoRoot),
    }
  }

  const index = await withIndexLock(lockPath, async () => {
    const current = await readFailureIndex(input.repoRoot)
    const next: FailureIndex = {
      ...current,
      version: 1,
      updatedAt: normalizedRecord.timestamp,
      entries: [...current.entries],
    }
    const existingIndex = next.entries.findIndex((entry) => entry.signature === normalizedRecord.signature)
    const merged = {
      ...mergeEntry(existingIndex >= 0 ? next.entries[existingIndex] : undefined, normalizedRecord),
      latestRecordPath: recordPath,
    }
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

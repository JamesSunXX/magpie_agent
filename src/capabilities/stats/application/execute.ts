import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { CapabilityContext } from '../../../core/capability/context.js'
import type {
  StatsCategoryCount,
  StatsFileCount,
  StatsPrepared,
  StatsRecentReview,
  StatsResult,
  StatsReviewIssue,
  StatsReviewRecord,
  StatsSeverityCount,
  StatsTargetCount,
} from '../types.js'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'nitpick'] as const

function listTargetDirs(historyDir: string): string[] {
  try {
    return readdirSync(historyDir).filter((entry) => {
      const fullPath = join(historyDir, entry)
      try {
        return statSync(fullPath).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function readReviewRecords(historyDir: string, cutoffTimestamp: string, ctx: CapabilityContext): StatsReviewRecord[] {
  const records: StatsReviewRecord[] = []

  for (const target of listTargetDirs(historyDir)) {
    const targetDir = join(historyDir, target)
    let files: string[] = []

    try {
      files = readdirSync(targetDir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.startsWith('review-') || !file.endsWith('.json')) continue

      try {
        const raw = JSON.parse(readFileSync(join(targetDir, file), 'utf-8')) as {
          timestamp?: string
          issues?: StatsReviewIssue[]
        }
        if (!raw.timestamp || !Array.isArray(raw.issues)) continue
        if (raw.timestamp < cutoffTimestamp) continue

        records.push({
          timestamp: raw.timestamp,
          target,
          issues: raw.issues,
        })
      } catch (error) {
        ctx.logger.warn(`[stats] Failed to parse history record ${join(targetDir, file)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return records
}

function sortByCount<T extends Record<string, string | number>>(items: T[], labelKey: keyof T): T[] {
  return items.sort((a, b) => {
    const countDiff = Number(b.count) - Number(a.count)
    if (countDiff !== 0) return countDiff
    return String(a[labelKey]).localeCompare(String(b[labelKey]))
  })
}

function aggregateSeverity(records: StatsReviewRecord[]): StatsSeverityCount[] {
  const counts = new Map<StatsSeverityCount['severity'], number>()

  for (const record of records) {
    for (const issue of record.issues) {
      counts.set(issue.severity, (counts.get(issue.severity) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
}

function aggregateFiles(records: StatsReviewRecord[]): StatsFileCount[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const issue of record.issues) {
      counts.set(issue.file, (counts.get(issue.file) || 0) + 1)
    }
  }

  return sortByCount(
    [...counts.entries()].map(([file, count]) => ({ file, count })),
    'file'
  )
}

function aggregateCategories(records: StatsReviewRecord[]): StatsCategoryCount[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const issue of record.issues) {
      counts.set(issue.category, (counts.get(issue.category) || 0) + 1)
    }
  }

  return sortByCount(
    [...counts.entries()].map(([category, count]) => ({ category, count })),
    'category'
  )
}

function aggregateTargets(records: StatsReviewRecord[]): StatsTargetCount[] {
  const counts = new Map<string, StatsTargetCount>()
  for (const record of records) {
    const current = counts.get(record.target) || {
      target: record.target,
      reviewCount: 0,
      issueCount: 0,
    }
    current.reviewCount += 1
    current.issueCount += record.issues.length
    counts.set(record.target, current)
  }

  return [...counts.values()].sort((a, b) => {
    const reviewDiff = b.reviewCount - a.reviewCount
    if (reviewDiff !== 0) return reviewDiff
    const issueDiff = b.issueCount - a.issueCount
    if (issueDiff !== 0) return issueDiff
    return a.target.localeCompare(b.target)
  })
}

function buildRecentReviews(records: StatsReviewRecord[]): StatsRecentReview[] {
  return records.map((record) => ({
    target: record.target,
    timestamp: record.timestamp,
    issueCount: record.issues.length,
  }))
}

export async function executeStats(prepared: StatsPrepared, ctx: CapabilityContext): Promise<StatsResult> {
  const records = readReviewRecords(prepared.historyDir, prepared.cutoffTimestamp, ctx)
  const issueCount = records.reduce((sum, record) => sum + record.issues.length, 0)

  return {
    repoName: prepared.repoName,
    windowDays: prepared.windowDays,
    generatedAt: ctx.now.toISOString(),
    records,
    totals: {
      reviewCount: records.length,
      targetCount: new Set(records.map((record) => record.target)).size,
      issueCount,
    },
    severityBreakdown: aggregateSeverity(records),
    topFiles: aggregateFiles(records),
    topCategories: aggregateCategories(records),
    topTargets: aggregateTargets(records),
    recentReviews: buildRecentReviews(records),
  }
}

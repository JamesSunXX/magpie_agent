export interface StatsInput {
  since?: number
  format?: 'markdown' | 'json'
}

export interface StatsPrepared {
  cwd: string
  repoName: string
  historyDir: string
  windowDays: number
  cutoffTimestamp: string
  format: 'markdown' | 'json'
}

export interface StatsReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'nitpick'
  category: string
  file: string
  title: string
  description: string
}

export interface StatsReviewRecord {
  timestamp: string
  target: string
  issues: StatsReviewIssue[]
}

export interface StatsSeverityCount {
  severity: StatsReviewIssue['severity']
  count: number
}

export interface StatsFileCount {
  file: string
  count: number
}

export interface StatsCategoryCount {
  category: string
  count: number
}

export interface StatsTargetCount {
  target: string
  reviewCount: number
  issueCount: number
}

export interface StatsRecentReview {
  target: string
  timestamp: string
  issueCount: number
}

export interface StatsTotals {
  reviewCount: number
  targetCount: number
  issueCount: number
}

export interface StatsResult {
  repoName: string
  windowDays: number
  generatedAt: string
  records: StatsReviewRecord[]
  totals: StatsTotals
  severityBreakdown: StatsSeverityCount[]
  topFiles: StatsFileCount[]
  topCategories: StatsCategoryCount[]
  topTargets: StatsTargetCount[]
  recentReviews: StatsRecentReview[]
}

export interface StatsSummaryJson {
  repoName: string
  generatedAt: string
  windowDays: number
  totals: StatsTotals
  severityBreakdown: StatsSeverityCount[]
  topFiles: StatsFileCount[]
  topCategories: StatsCategoryCount[]
  topTargets: StatsTargetCount[]
  recentReviews: StatsRecentReview[]
}

export interface StatsSummary {
  format: 'markdown' | 'json'
  text: string
  json: StatsSummaryJson
}

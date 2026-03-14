import type { CapabilityContext } from '../../../core/capability/context.js'
import type { StatsResult, StatsSummary } from '../types.js'

function renderCountList<T>(
  items: T[],
  formatter: (item: T) => string,
  emptyLabel = '- None'
): string[] {
  if (items.length === 0) return [emptyLabel]
  return items.map(formatter)
}

function toMarkdown(result: StatsResult): string {
  const lines = [
    `# ${result.repoName} Review Stats`,
    '',
    `Window: last ${result.windowDays} day(s)`,
    `Generated: ${result.generatedAt}`,
    '',
  ]

  if (result.totals.reviewCount === 0) {
    lines.push('No review history found for this repository in the selected window.')
    return lines.join('\n')
  }

  lines.push('## Totals')
  lines.push(`- Reviews: ${result.totals.reviewCount}`)
  lines.push(`- Targets: ${result.totals.targetCount}`)
  lines.push(`- Issues: ${result.totals.issueCount}`)
  lines.push('')
  lines.push('## Severity Breakdown')
  lines.push(...renderCountList(result.severityBreakdown, (item) => `- ${item.severity}: ${item.count}`))
  lines.push('')
  lines.push('## Top Files')
  lines.push(...renderCountList(result.topFiles.slice(0, 10), (item) => `- ${item.file}: ${item.count}`))
  lines.push('')
  lines.push('## Top Categories')
  lines.push(...renderCountList(result.topCategories.slice(0, 10), (item) => `- ${item.category}: ${item.count}`))
  lines.push('')
  lines.push('## Top Targets')
  lines.push(...renderCountList(result.topTargets.slice(0, 10), (item) => `- ${item.target}: ${item.reviewCount} reviews, ${item.issueCount} issues`))
  lines.push('')
  lines.push('## Recent Review Trend')
  lines.push(...renderCountList(result.recentReviews.slice(0, 10), (item) => `- ${item.timestamp} ${item.target}: ${item.issueCount} issues`))

  return lines.join('\n')
}

export async function summarizeStats(result: StatsResult, _ctx: CapabilityContext): Promise<StatsSummary> {
  const format = (_ctx.metadata?.format as 'markdown' | 'json' | undefined) === 'json' ? 'json' : 'markdown'

  return {
    format,
    text: toMarkdown(result),
    json: {
      repoName: result.repoName,
      generatedAt: result.generatedAt,
      windowDays: result.windowDays,
      totals: result.totals,
      severityBreakdown: result.severityBreakdown,
      topFiles: result.topFiles,
      topCategories: result.topCategories,
      topTargets: result.topTargets,
      recentReviews: result.recentReviews,
    },
  }
}

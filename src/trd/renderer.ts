import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { DomainOverview, DomainBoundary, TrdSynthesisResult } from './types.js'

export function renderDomainOverviewMarkdown(overview: DomainOverview): string {
  const lines: string[] = []
  lines.push('# 领域定义架构总览')
  lines.push('')
  lines.push('## 总览')
  lines.push(overview.summary || '（暂无）')
  lines.push('')
  lines.push('## 领域拆分原则')
  for (const p of overview.principles) lines.push(`- ${p}`)
  lines.push('')
  lines.push('## 领域边界')
  for (const d of overview.domains) {
    lines.push(`### ${d.name} (${d.id})`)
    lines.push(`- Owner: ${d.owner}`)
    lines.push(`- Description: ${d.description}`)
    lines.push(`- In Scope: ${d.inScope.join('；') || '无'}`)
    lines.push(`- Out of Scope: ${d.outOfScope.join('；') || '无'}`)
    lines.push(`- Upstreams: ${d.upstreams.join('，') || '无'}`)
    lines.push(`- Downstreams: ${d.downstreams.join('，') || '无'}`)
    lines.push(`- Contracts: ${d.contracts.join('，') || '无'}`)
    lines.push('')
  }

  lines.push('## 跨域流程')
  for (const f of overview.crossDomainFlows) lines.push(`- ${f}`)
  lines.push('')
  lines.push('## 风险')
  for (const r of overview.risks) lines.push(`- ${r}`)
  lines.push('')

  return lines.join('\n')
}

export function renderDomainDraftYaml(overview: DomainOverview): string {
  return stringifyYaml({
    domains: overview.domains,
  })
}

export function parseConfirmedDomainsYaml(yamlText: string): DomainBoundary[] {
  const parsed = parseYaml(yamlText) as { domains?: DomainBoundary[] } | null
  if (!parsed || !Array.isArray(parsed.domains)) {
    throw new Error('Invalid domains yaml: expected root "domains" array')
  }
  return parsed.domains
}

export function extractJsonBlock<T>(text: string): T | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}

export function renderOpenQuestionsMarkdown(result: TrdSynthesisResult): string {
  const lines: string[] = []
  lines.push('# 待确认清单')
  lines.push('')
  lines.push('| ID | 优先级 | 领域 | 是否阻塞 | 问题 |')
  lines.push('|---|---|---|---|---|')
  for (const q of result.openQuestions) {
    lines.push(`| ${q.id} | ${q.priority} | ${q.domain} | ${q.blocker ? '是' : '否'} | ${q.question} |`)
  }
  lines.push('')
  return lines.join('\n')
}


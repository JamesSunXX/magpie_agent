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
  const body = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(body) as T
  } catch {
    const candidate = extractBalancedJsonSnippet(body)
    if (!candidate) {
      return null
    }

    try {
      return JSON.parse(candidate) as T
    } catch {
      return null
    }
  }
}

function extractBalancedJsonSnippet(text: string): string | null {
  for (let start = 0; start < text.length; start++) {
    const opening = text[start]
    if (opening !== '{' && opening !== '[') {
      continue
    }

    const stack: string[] = [opening]
    let inString = false
    let escape = false

    for (let idx = start + 1; idx < text.length; idx++) {
      const char = text[idx]

      if (inString) {
        if (escape) {
          escape = false
          continue
        }
        if (char === '\\') {
          escape = true
          continue
        }
        if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{' || char === '[') {
        stack.push(char)
        continue
      }

      if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        if (stack.at(-1) !== expected) {
          break
        }
        stack.pop()
        if (stack.length === 0) {
          return text.slice(start, idx + 1)
        }
      }
    }
  }

  return null
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

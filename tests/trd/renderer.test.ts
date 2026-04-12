import { describe, it, expect } from 'vitest'
import {
  renderDomainDraftYaml,
  parseConfirmedDomainsYaml,
  extractJsonBlock,
  renderOpenQuestionsMarkdown,
} from '../../src/trd/renderer.js'
import type { DomainOverview, TrdSynthesisResult } from '../../src/trd/types.js'

describe('trd renderer helpers', () => {
  const overview: DomainOverview = {
    summary: 'summary',
    principles: ['p1'],
    domains: [
      {
        id: 'payment',
        name: '支付',
        description: '支付领域',
        owner: 'team-a',
        inScope: ['支付下单'],
        outOfScope: ['营销'],
        upstreams: ['order'],
        downstreams: ['ledger'],
        contracts: ['createPayment'],
      },
    ],
    crossDomainFlows: ['order->payment->ledger'],
    risks: ['risk-1'],
  }

  it('serializes and parses domain yaml', () => {
    const yaml = renderDomainDraftYaml(overview)
    const domains = parseConfirmedDomainsYaml(yaml)
    expect(domains).toHaveLength(1)
    expect(domains[0].id).toBe('payment')
  })

  it('extracts json block from fenced markdown', () => {
    const parsed = extractJsonBlock<{ value: string }>('```json\n{"value":"ok"}\n```')
    expect(parsed?.value).toBe('ok')
  })

  it('extracts json block from prose-wrapped output', () => {
    const parsed = extractJsonBlock<{ value: string }>('Here is the result:\n{"value":"ok"}\nThanks.')
    expect(parsed?.value).toBe('ok')
  })

  it('skips earlier brace fragments before the real json payload', () => {
    const parsed = extractJsonBlock<{ value: string }>('Use {value, other} fields.\nActual payload:\n{"value":"ok"}')
    expect(parsed?.value).toBe('ok')
  })

  it('renders open questions markdown table', () => {
    const synthesis: TrdSynthesisResult = {
      trdMarkdown: '# test',
      openQuestions: [
        { id: 'Q1', question: '待确认', priority: 'high', domain: 'payment', blocker: true },
      ],
      traceability: [],
    }
    const markdown = renderOpenQuestionsMarkdown(synthesis)
    expect(markdown).toContain('| ID | 优先级 | 领域 | 是否阻塞 | 问题 |')
    expect(markdown).toContain('Q1')
  })
})

import type { DomainRequirementBundle, DomainOverview } from './types.js'

export const DOMAIN_SPLIT_RULES = [
  '业务能力边界优先',
  '数据主权唯一归属',
  '强一致事务尽量不跨域',
  '变更频率差异明显则分域',
  'SLA/安全/合规差异则分域',
  '每个领域必须有 owner 与上下游契约',
]

export const TRD_ANALYZER_PROMPT = `你是资深架构师，负责先从 PRD 中抽取领域边界。
你必须严格遵循以下领域拆分规则：
${DOMAIN_SPLIT_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

输出必须为 JSON，结构如下：
\`\`\`json
{
  "summary": "一句话概述",
  "principles": ["..."],
  "domains": [
    {
      "id": "domain-1",
      "name": "领域名",
      "description": "描述",
      "owner": "负责人或团队",
      "inScope": ["..."],
      "outOfScope": ["..."],
      "upstreams": ["..."],
      "downstreams": ["..."],
      "contracts": ["..."]
    }
  ],
  "crossDomainFlows": ["..."],
  "risks": ["..."]
}
\`\`\`
只输出 JSON，不要额外解释。`

export const DOMAIN_REVIEWER_PROMPT = `你是技术方案评审专家。请对分配给当前领域的需求进行深度讨论：
1. 领域内实现方案是否可落地
2. 与上下游的契约是否清晰
3. 风险与权衡是否充分
4. 测试与上线回滚是否可执行

请用中文作答，输出要具体，优先指出隐含风险。`

export const DOMAIN_SUMMARIZER_PROMPT = `你是中立的技术总结者。
基于所有评审观点，输出本领域的技术方案结论（Markdown），内容需要可直接进入 TRD。`

export const INTEGRATION_SUMMARIZER_PROMPT = `你是最终 TRD 汇总负责人。
输入包含多个领域的 partial TRD，请输出 JSON：
\`\`\`json
{
  "trdMarkdown": "完整 Markdown，包含：背景与目标、范围与非范围、现状与约束、总体技术方案、数据与接口设计、关键流程与时序、风险与取舍、测试验收与上线回滚、附录追踪表",
  "openQuestions": [
    {
      "id": "Q-001",
      "question": "待确认问题",
      "priority": "high|medium|low",
      "domain": "领域名",
      "blocker": true
    }
  ],
  "traceability": [
    {
      "requirementId": "REQ-001",
      "domainId": "domain-1",
      "decision": "该需求对应的技术决策"
    }
  ]
}
\`\`\`
只输出 JSON，不要额外解释。`

export function buildDomainOverviewPrompt(prdDigest: string): string {
  return `请基于以下 PRD 摘要生成领域总览：\n\n${prdDigest}`
}

export function buildDomainPrompt(bundle: DomainRequirementBundle, overview: DomainOverview): string {
  const reqText = bundle.requirements.map(r => `- ${r.id}: ${r.text}`).join('\n')
  return `当前领域：${bundle.domain.name}
领域描述：${bundle.domain.description}
Owner：${bundle.domain.owner}

领域内需求：
${reqText || '- （无明确分配需求，请补全）'}

跨域上下文：
- Upstreams: ${bundle.domain.upstreams.join(', ') || '无'}
- Downstreams: ${bundle.domain.downstreams.join(', ') || '无'}
- Contracts: ${bundle.domain.contracts.join(', ') || '无'}

全局风险：
${overview.risks.map(r => `- ${r}`).join('\n') || '- 无'}

请输出该领域 TRD 的完整 Markdown 片段。`
}

export function buildIntegrationPrompt(
  overview: DomainOverview,
  partials: Array<{ domainId: string; content: string }>,
  traceabilityRows: string
): string {
  const partialText = partials.map(p => `## ${p.domainId}\n${p.content}`).join('\n\n')
  return `领域总览：
${JSON.stringify(overview, null, 2)}

各领域 partial TRD：
${partialText}

PRD 追踪信息：
${traceabilityRows}

请基于以上内容输出最终结果。`
}


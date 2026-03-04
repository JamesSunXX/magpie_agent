import type {
  ParsedPrd,
  PrdRequirement,
  DomainOverview,
  DomainRequirementBundle,
} from './types.js'

export function buildPrdDigestText(parsed: ParsedPrd, maxChars = 120000): string {
  const lines: string[] = []
  lines.push(`# ${parsed.title}`)
  lines.push('')
  lines.push('## 需求条目')
  for (const req of parsed.requirements) {
    lines.push(`- ${req.id} [${req.section || 'General'}] ${req.text}`)
  }
  lines.push('')
  lines.push('## 图片信息')
  for (const img of parsed.images) {
    const detail = img.error
      ? `OCR失败: ${img.error}`
      : (img.ocrText ? `OCR: ${img.ocrText}` : '无OCR文本')
    lines.push(`- IMG-${String(img.index).padStart(3, '0')} ${img.source} ${detail}`)
  }

  const digest = lines.join('\n')
  return digest.length > maxChars ? `${digest.slice(0, maxChars)}\n\n[TRUNCATED]` : digest
}

export function splitTextIntoChunks(text: string, chunkChars: number): string[] {
  if (text.length <= chunkChars) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length)
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

function scoreRequirementForDomain(req: PrdRequirement, domainName: string, domainDesc: string): number {
  const haystack = `${req.text} ${req.section || ''}`.toLowerCase()
  const needles = `${domainName} ${domainDesc}`.toLowerCase().split(/\s+/).filter(Boolean)
  let score = 0
  for (const n of needles) {
    if (n.length < 2) continue
    if (haystack.includes(n)) score += 1
  }
  return score
}

export function mapRequirementsToDomains(
  requirements: PrdRequirement[],
  overview: DomainOverview
): DomainRequirementBundle[] {
  const bundles = overview.domains.map(domain => ({
    domain,
    requirements: [] as PrdRequirement[],
  }))

  if (bundles.length === 0) {
    return []
  }

  for (const req of requirements) {
    let bestIndex = 0
    let bestScore = -1
    for (let i = 0; i < bundles.length; i++) {
      const score = scoreRequirementForDomain(req, bundles[i].domain.name, bundles[i].domain.description)
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    bundles[bestIndex].requirements.push(req)
  }

  return bundles
}


import { execFileSync } from 'child_process'
import type { AIProvider } from '../../../platform/providers/index.js'

const AUTO_BRANCH_SYSTEM_PROMPT = `你负责生成 Git 分支名中的语义 slug。

要求：
1. 只输出 slug 本身，不要输出前缀、时间戳、解释或代码块。
2. 使用小写英文单词，用短横线连接。
3. 保持简短，优先 3 到 6 个词。
4. 尽量准确表达当前任务目标。
5. 不要输出 sch、feature、branch、task 这类泛词。

示例：
- admin-cancel-audit-sync
- payment-timeout-retry
- docs-review-workflow`

const GENERIC_PATH_SEGMENTS = new Set([
  'doc',
  'docs',
  'current',
  'prd',
  'trd',
  'spec',
  'specs',
  'requirement',
  'requirements',
  'feature',
  'features',
])

export interface AutoBranchNameResult {
  branchName: string
  slug: string
  source: 'ai' | 'fallback'
  reason?: string
}

function trimOutput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n```$/, '')
    .trim()
}

function normalizeCandidateLine(line: string): string {
  return line
    .trim()
    .replace(/^>\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(branch name|branch|slug|分支名)[:：]\s*/i, '')
}

function sanitizeBranchSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, ' ')
    .toLowerCase()
    .replace(/[_/.\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function compressBranchSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
}

function extractBranchSlug(raw: string): string {
  const trimmed = trimOutput(raw)
  if (!trimmed) {
    return ''
  }

  const lines = trimmed.split('\n')
  for (const line of lines) {
    const candidate = compressBranchSlug(sanitizeBranchSlug(normalizeCandidateLine(line)))
    if (candidate) {
      return candidate
    }
  }

  return compressBranchSlug(sanitizeBranchSlug(normalizeCandidateLine(trimmed)))
}

function deriveSlugFromGoal(goal: string): string {
  return compressBranchSlug(sanitizeBranchSlug(goal))
}

function stripExtension(segment: string): string {
  return segment.replace(/\.[^.]+$/, '')
}

function deriveSlugFromPrdPath(prdPath?: string): string {
  if (!prdPath) {
    return ''
  }

  const informativeSegments = prdPath
    .split(/[\\/]+/)
    .map(stripExtension)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase()))
    .map((segment) => sanitizeBranchSlug(segment))
    .filter(Boolean)

  if (informativeSegments.length === 0) {
    return ''
  }

  return informativeSegments[informativeSegments.length - 1] || ''
}

function deriveFallbackSlug(goal: string, prdPath?: string): string {
  return deriveSlugFromGoal(goal) || deriveSlugFromPrdPath(prdPath)
}

function normalizeBranchPrefix(prefix: string): string {
  const normalizedPrefix = prefix.startsWith('sch/') ? prefix : `sch/${prefix.replace(/^\/+/, '')}`
  const sanitizedPrefix = normalizedPrefix
    .replace(/[^a-zA-Z0-9/_\-.]/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^-+/, '')
    .replace(/\/-+/g, '/')

  const safePrefix = sanitizedPrefix.length > 0 ? sanitizedPrefix : 'sch'
  return safePrefix.endsWith('/') ? safePrefix : `${safePrefix}/`
}

function formatTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
}

function validateBranchName(branchName: string, cwd?: string): boolean {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName) || branchName.length > 100) {
    return false
  }

  if (!cwd) {
    return true
  }

  try {
    execFileSync('git', ['check-ref-format', '--branch', branchName], { stdio: 'pipe', cwd })
    return true
  } catch {
    return false
  }
}

function buildBranchName(prefix: string, slug: string, now: Date, cwd?: string): string | null {
  const finalPrefix = normalizeBranchPrefix(prefix)
  const timestamp = formatTimestamp(now)
  const maxSlugLength = 100 - finalPrefix.length - timestamp.length - 1
  const limitedSlug = maxSlugLength > 0
    ? slug.slice(0, maxSlugLength).replace(/-+$/g, '')
    : ''
  const branchName = limitedSlug
    ? `${finalPrefix}${limitedSlug}-${timestamp}`
    : `${finalPrefix}${timestamp}`

  return validateBranchName(branchName, cwd) ? branchName : null
}

async function generateAiSlug(
  provider: AIProvider,
  goal: string,
  prdPath?: string
): Promise<string> {
  const response = await provider.chat([
    {
      role: 'user',
      content: [
        `任务目标：${goal}`,
        prdPath ? `PRD 路径：${prdPath}` : '',
      ].filter(Boolean).join('\n'),
    },
  ], AUTO_BRANCH_SYSTEM_PROMPT, { disableTools: true })

  return extractBranchSlug(response)
}

export async function generateAutoBranchName(input: {
  prefix: string
  goal: string
  prdPath?: string
  provider?: AIProvider
  now?: Date
  cwd?: string
}): Promise<AutoBranchNameResult | null> {
  const now = input.now || new Date()
  const fallbackSlug = deriveFallbackSlug(input.goal, input.prdPath)

  if (input.provider) {
    try {
      const aiSlug = await generateAiSlug(input.provider, input.goal, input.prdPath)
      if (aiSlug) {
        const branchName = buildBranchName(input.prefix, aiSlug, now, input.cwd)
        if (branchName) {
          return {
            branchName,
            slug: aiSlug,
            source: 'ai',
          }
        }
      }
    } catch (error) {
      const fallbackBranchName = buildBranchName(input.prefix, fallbackSlug, now, input.cwd)
      return fallbackBranchName
        ? {
          branchName: fallbackBranchName,
          slug: fallbackSlug,
          source: 'fallback',
          reason: error instanceof Error ? error.message : String(error),
        }
        : null
    }
  }

  const fallbackBranchName = buildBranchName(input.prefix, fallbackSlug, now, input.cwd)
  return fallbackBranchName
    ? {
      branchName: fallbackBranchName,
      slug: fallbackSlug,
      source: 'fallback',
      ...(input.provider ? { reason: 'invalid_slug' } : {}),
    }
    : null
}

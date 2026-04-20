import { execFileSync } from 'child_process'
import type { AIProvider } from '../../../platform/providers/index.js'
import type { LoopStageName } from '../../../config/types.js'

const COMMIT_MESSAGE_SYSTEM_PROMPT = `使用中文生成简洁的 Git 提交信息，需同时遵循以下规则：
### 基础规则
1. 提交信息应简洁明了，概括主要更改内容。
2. 使用祈使句形式，例如“修复错误”而不是“修复了错误”。
3. 避免使用第一人称，如“我”或“我们”。
4. 如果更改涉及多个方面，优先突出最重要的更改。
5. 保持提交信息的标题部分（首行）在50个字符以内，必要时可添加更详细的描述在正文部分。
6. 确保语法正确，避免拼写错误。
### 约定式提交（Conventional Commits）规范
7. 提交信息标题必须遵循固定格式：<type>(<scope>):<描述>
- type（必填）：标记提交类型，可选值包括：
- feat：新增功能
- fix：修复bug
- docs：仅文档更新（如注释、README）
- style：仅代码格式调整（不影响逻辑，如缩进、空格）
- refactor：代码重构（既非新增功能也非修复bug）
- test：新增/修改测试代码
- chore：构建/工具链/依赖等杂项修改
- scope（可选）：说明修改影响的范围（如模块名、组件名、功能点，例：login、order、payment）
- 描述（必填）：符合基础规则的祈使句，概括核心更改
8. 若有破坏性变更（修改导致现有功能失效），需在正文以“BREAKING CHANGE: ”开头说明；若需关联issue/PR，可在正文添加（如“Closes #123”）。

只输出最终提交信息，不要解释。`

const TITLE_PATTERN = /^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?:\s*.+$/
const MAX_TITLE_LENGTH = 50
const MAX_SUMMARY_CHARS = 4000

function normalizeStageForCommit(stage: LoopStageName): LoopStageName | 'implementation' {
  return stage === ('code_development' as LoopStageName) ? 'implementation' : stage
}

export function defaultAutoCommitMessage(stage: LoopStageName): string {
  return `feat(loop): 完成${normalizeStageForCommit(stage)}`
}

export interface AutoCommitMessageResult {
  message: string
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
    .replace(/^提交信息[:：]\s*/i, '')
    .replace(/^commit message[:：]\s*/i, '')
    .replace(/^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?：/i, '$1$2:')
}

function extractCommitMessage(raw: string): string {
  const trimmed = trimOutput(raw)
  if (!trimmed) {
    return ''
  }

  const lines = trimmed.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const title = normalizeCandidateLine(lines[index] || '')
    if (!title) {
      continue
    }
    if (!isValidCommitMessage(title)) {
      continue
    }

    const body = lines
      .slice(index + 1)
      .map((line) => line.trimEnd())
      .filter((line, bodyIndex, all) => line.length > 0 || all.slice(bodyIndex + 1).some(Boolean))
      .join('\n')
      .trim()

    return body ? `${title}\n${body}` : title
  }

  return normalizeCandidateLine(trimmed)
}

function isValidCommitMessage(message: string): boolean {
  const [title] = message.split('\n')
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return false
  }
  return TITLE_PATTERN.test(title)
}

function readGitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024,
  }).trim()
}

function truncateSection(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_SUMMARY_CHARS)}\n...(truncated)`
}

function buildStagedChangeSummary(cwd: string): string {
  const status = readGitOutput(cwd, ['diff', '--cached', '--name-status'])
  const numstat = readGitOutput(cwd, ['diff', '--cached', '--numstat'])
  const stat = readGitOutput(cwd, ['diff', '--cached', '--stat'])

  return [
    '已暂存改动安全摘要（不包含原始 diff 内容）：',
    '',
    '[name-status]',
    truncateSection(status || '(empty)'),
    '',
    '[numstat]',
    truncateSection(numstat || '(empty)'),
    '',
    '[stat]',
    truncateSection(stat || '(empty)'),
  ].join('\n').trim()
}

export async function generateAutoCommitMessage(input: {
  cwd: string
  stage: LoopStageName
  provider: AIProvider
}): Promise<AutoCommitMessageResult> {
  const fallback = defaultAutoCommitMessage(input.stage)

  try {
    const summary = buildStagedChangeSummary(input.cwd)
    const response = await input.provider.chat([
      {
        role: 'user',
        content: [
          `当前阶段：${input.stage}`,
          '',
          summary,
        ].join('\n'),
      },
    ], COMMIT_MESSAGE_SYSTEM_PROMPT, { disableTools: true })

    const message = extractCommitMessage(response)
    if (!isValidCommitMessage(message)) {
      return {
        message: fallback,
        source: 'fallback',
        reason: 'invalid_message',
      }
    }

    return {
      message,
      source: 'ai',
    }
  } catch (error) {
    return {
      message: fallback,
      source: 'fallback',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

import type { MagpieConfig } from '../../../config/types.js'
import { createConfiguredProvider } from '../../../providers/configured-provider.js'
import { getProviderForModel, getProviderForTool } from '../../../providers/factory.js'
import { extractJsonBlock } from '../../../trd/renderer.js'
import {
  buildFallbackStageNotificationMessage,
  buildStageSummaryPrompt,
  type StageNotificationMessage,
  type StageNotificationSummaryInput,
} from './stage-summary.js'

interface SummarizeStageNotificationArgs {
  config: MagpieConfig
  cwd: string
  input: StageNotificationSummaryInput
}

interface StageSummaryJson {
  title?: string
  body?: string
}

const DEFAULT_STAGE_AI_TIMEOUT_MS = 2000

function resolveBinding(provider: string): { tool?: string; model?: string } {
  try {
    getProviderForTool(provider)
    return { tool: provider }
  } catch {
    getProviderForModel(provider)
    return { model: provider }
  }
}

export async function summarizeStageNotification(
  args: SummarizeStageNotificationArgs
): Promise<StageNotificationMessage> {
  const notifications = args.config.integrations.notifications
  const stageAi = notifications?.stage_ai
  const maxChars = stageAi?.max_summary_chars
  const fallback = buildFallbackStageNotificationMessage(args.input, maxChars)

  if (!stageAi?.enabled || !stageAi.provider) {
    return fallback
  }

  try {
    const timeoutMs = stageAi.timeout_ms ?? DEFAULT_STAGE_AI_TIMEOUT_MS
    const binding = resolveBinding(stageAi.provider)
    const provider = createConfiguredProvider({
      logicalName: 'integrations.notifications.stage_ai',
      ...binding,
      timeoutMs,
    }, args.config)
    provider.setCwd?.(args.cwd)

    const timeoutError = new Error(`Stage AI summarizer timed out after ${timeoutMs}ms`)
    const response = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError), timeoutMs)
      void provider.chat(
        [{ role: 'user', content: buildStageSummaryPrompt(args.input) }],
        'You write concise Chinese stage notifications for engineering workflow events.',
        { disableTools: true }
      ).then((value) => {
        clearTimeout(timer)
        resolve(value)
      }).catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    const parsed = extractJsonBlock<StageSummaryJson>(response)
    if (!parsed?.title || !parsed?.body) {
      return fallback
    }

    return {
      title: parsed.title.slice(0, 200),
      body: typeof maxChars === 'number' && maxChars > 0 ? parsed.body.slice(0, maxChars) : parsed.body,
    }
  } catch {
    return fallback
  }
}

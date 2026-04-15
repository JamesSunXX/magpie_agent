import { execFileSync } from 'child_process'
import type { MagpieConfigV2 } from '../../../../platform/config/types.js'
import { getProviderForTool } from '../../../../providers/factory.js'

const CLAUDE_MODEL = 'claude-code'
const KIRO_MODEL = 'kiro'
const CLAUDE_PROBE_RESPONSE = 'MAGPIE_CLAUDE_OK'
const DEFAULT_PROVIDER_CHECK_TIMEOUT_MS = 10_000

interface ModelBinding {
  path: string
  getProvider(): string | undefined
  replaceProvider(model: string): void
}

interface ClaudeAuthRecord {
  checked: boolean
  ok: boolean
  loggedIn: boolean
  authMethod?: string
  subscriptionType?: string
  reason?: string
}

interface ProbeRecord {
  checked: boolean
  ok: boolean
  reason?: string
  response?: string
}

export interface HarnessProviderSelectionRecord {
  checkedAt: string
  hasPreciseUsage: boolean
  decision: 'keep_claude' | 'fallback_to_kiro' | 'fallback_failed' | 'no_claude_in_harness'
  replacements: string[]
  claudeAuth: ClaudeAuthRecord
  claudeProbe: ProbeRecord
  kiroCheck: ProbeRecord
}

export interface HarnessProviderSelectionResult {
  record: HarnessProviderSelectionRecord
}

function runCommand(cwd: string, file: string, args: string[]): string {
  const rawTimeout = process.env.MAGPIE_HARNESS_PROVIDER_CHECK_TIMEOUT_MS
  const parsedTimeout = rawTimeout ? Number(rawTimeout) : Number.NaN
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 0
    ? Math.floor(parsedTimeout)
    : DEFAULT_PROVIDER_CHECK_TIMEOUT_MS
  return execFileSync(file, args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: timeoutMs,
  }).trim()
}

function normalizeCommandError(error: unknown): string {
  const value = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
  const parts = [value.stdout, value.stderr, value.message]
    .filter(Boolean)
    .map(item => String(item).trim())
    .filter(Boolean)

  return parts.join('\n') || 'Unknown command failure'
}

function isTimeoutFailure(reason: string | undefined): boolean {
  if (!reason) return false
  return /ETIMEDOUT|timed out/i.test(reason)
}

// Harness can touch several provider bindings in one run; collect them once so a
// single fallback decision rewrites every Claude-backed role consistently.
function collectModelBindings(config: MagpieConfigV2, reviewerIds: string[]): ModelBinding[] {
  const providerFromBinding = (tool?: string, model?: string): string | undefined => {
    if (tool) {
      return getProviderForTool(tool)
    }
    return model
  }

  const bindings: ModelBinding[] = reviewerIds.map((reviewerId) => ({
    path: `reviewers.${reviewerId}.model`,
    getProvider: () => providerFromBinding(config.reviewers?.[reviewerId]?.tool, config.reviewers?.[reviewerId]?.model),
    replaceProvider: (model: string) => {
      const reviewer = config.reviewers?.[reviewerId]
      if (!reviewer) return
      if (reviewer.tool) {
        reviewer.tool = model === CLAUDE_MODEL ? 'claude' : model
      } else {
        reviewer.model = model
      }
    },
  }))

  bindings.push(
    {
      path: 'summarizer.model',
      getProvider: () => providerFromBinding(config.summarizer?.tool, config.summarizer?.model),
      replaceProvider: (model: string) => {
        if (!config.summarizer) return
        if (config.summarizer.tool) {
          config.summarizer.tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.summarizer.model = model
        }
      },
    },
    {
      path: 'analyzer.model',
      getProvider: () => providerFromBinding(config.analyzer?.tool, config.analyzer?.model),
      replaceProvider: (model: string) => {
        if (!config.analyzer) return
        if (config.analyzer.tool) {
          config.analyzer.tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.analyzer.model = model
        }
      },
    },
    {
      path: 'capabilities.loop.planner_model',
      getProvider: () => providerFromBinding(config.capabilities.loop?.planner_tool, config.capabilities.loop?.planner_model),
      replaceProvider: (model: string) => {
        if (!config.capabilities.loop) return
        if (config.capabilities.loop.planner_tool) {
          config.capabilities.loop.planner_tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.capabilities.loop.planner_model = model
        }
      },
    },
    {
      path: 'capabilities.loop.executor_model',
      getProvider: () => providerFromBinding(config.capabilities.loop?.executor_tool, config.capabilities.loop?.executor_model),
      replaceProvider: (model: string) => {
        if (!config.capabilities.loop) return
        if (config.capabilities.loop.executor_tool) {
          config.capabilities.loop.executor_tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.capabilities.loop.executor_model = model
        }
      },
    },
    {
      path: 'capabilities.issue_fix.planner_model',
      getProvider: () => providerFromBinding(config.capabilities.issue_fix?.planner_tool, config.capabilities.issue_fix?.planner_model),
      replaceProvider: (model: string) => {
        if (!config.capabilities.issue_fix) return
        if (config.capabilities.issue_fix.planner_tool) {
          config.capabilities.issue_fix.planner_tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.capabilities.issue_fix.planner_model = model
        }
      },
    },
    {
      path: 'capabilities.issue_fix.executor_model',
      getProvider: () => providerFromBinding(config.capabilities.issue_fix?.executor_tool, config.capabilities.issue_fix?.executor_model),
      replaceProvider: (model: string) => {
        if (!config.capabilities.issue_fix) return
        if (config.capabilities.issue_fix.executor_tool) {
          config.capabilities.issue_fix.executor_tool = model === CLAUDE_MODEL ? 'claude' : model
        } else {
          config.capabilities.issue_fix.executor_model = model
        }
      },
    },
  )

  return bindings
}

function checkClaudeAuth(cwd: string): ClaudeAuthRecord {
  try {
    const raw = runCommand(cwd, 'claude', ['auth', 'status'])
    const parsed = JSON.parse(raw) as {
      loggedIn?: boolean
      authMethod?: string
      subscriptionType?: string
    }

    if (parsed.loggedIn !== true) {
      return {
        checked: true,
        ok: false,
        loggedIn: false,
        authMethod: parsed.authMethod,
        subscriptionType: parsed.subscriptionType,
        reason: 'Claude auth status reports loggedIn=false.',
      }
    }

    return {
      checked: true,
      ok: true,
      loggedIn: true,
      authMethod: parsed.authMethod,
      subscriptionType: parsed.subscriptionType,
    }
  } catch (error) {
    return {
      checked: true,
      ok: false,
      loggedIn: false,
      reason: normalizeCommandError(error),
    }
  }
}

function probeClaude(cwd: string): ProbeRecord {
  try {
    const response = runCommand(cwd, 'claude', [
      '-p',
      `Reply with exactly ${CLAUDE_PROBE_RESPONSE} and nothing else.`,
      '--tools',
      '',
    ])

    if (response === CLAUDE_PROBE_RESPONSE) {
      return {
        checked: true,
        ok: true,
        response,
      }
    }

    return {
      checked: true,
      ok: false,
      response,
      reason: `Unexpected Claude probe response: ${response || '(empty)'}`,
    }
  } catch (error) {
    return {
      checked: true,
      ok: false,
      reason: normalizeCommandError(error),
    }
  }
}

function checkKiro(cwd: string): ProbeRecord {
  try {
    runCommand(cwd, 'kiro-cli', ['--help'])
    return {
      checked: true,
      ok: true,
    }
  } catch (error) {
    return {
      checked: true,
      ok: false,
      reason: normalizeCommandError(error),
    }
  }
}

/**
 * Prefer keeping Claude when auth and a lightweight probe both succeed. Fall back
 * to Kiro only when Claude is clearly unusable for this harness run.
 */
export function selectHarnessProviders(
  config: MagpieConfigV2,
  reviewerIds: string[],
  cwd: string,
  now: Date = new Date()
): HarnessProviderSelectionResult {
  const bindings = collectModelBindings(config, reviewerIds)
  const claudeBindings = bindings.filter(binding => binding.getProvider() === CLAUDE_MODEL)

  const record: HarnessProviderSelectionRecord = {
    checkedAt: now.toISOString(),
    hasPreciseUsage: false,
    decision: 'no_claude_in_harness',
    replacements: [],
    claudeAuth: {
      checked: false,
      ok: false,
      loggedIn: false,
    },
    claudeProbe: {
      checked: false,
      ok: false,
    },
    kiroCheck: {
      checked: false,
      ok: false,
    },
  }

  if (claudeBindings.length === 0) {
    return { record }
  }

  record.claudeAuth = checkClaudeAuth(cwd)
  if (record.claudeAuth.ok) {
    record.claudeProbe = probeClaude(cwd)
  }

  if (record.claudeAuth.ok && record.claudeProbe.ok) {
    record.decision = 'keep_claude'
    return { record }
  }

  // Treat probe timeouts as transient harness noise rather than a hard Claude
  // failure; swapping providers on a slow probe causes unnecessary drift.
  if (record.claudeAuth.ok && isTimeoutFailure(record.claudeProbe.reason)) {
    record.decision = 'keep_claude'
    return { record }
  }

  record.kiroCheck = checkKiro(cwd)
  if (!record.kiroCheck.ok) {
    record.decision = 'fallback_failed'
    return { record }
  }

  for (const binding of claudeBindings) {
    binding.replaceProvider(KIRO_MODEL)
    record.replacements.push(binding.path)
  }

  record.decision = 'fallback_to_kiro'
  return { record }
}

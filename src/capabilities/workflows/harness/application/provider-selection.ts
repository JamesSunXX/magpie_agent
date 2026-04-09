import { execFileSync } from 'child_process'
import type { MagpieConfigV2 } from '../../../../platform/config/types.js'

const CLAUDE_MODEL = 'claude-code'
const KIRO_MODEL = 'kiro'
const CLAUDE_PROBE_RESPONSE = 'MAGPIE_CLAUDE_OK'

interface ModelBinding {
  path: string
  getModel(): string | undefined
  setModel(model: string): void
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
  return execFileSync(file, args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
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

function collectModelBindings(config: MagpieConfigV2, reviewerIds: string[]): ModelBinding[] {
  const bindings: ModelBinding[] = reviewerIds.map((reviewerId) => ({
    path: `reviewers.${reviewerId}.model`,
    getModel: () => config.reviewers?.[reviewerId]?.model,
    setModel: (model: string) => {
      const reviewer = config.reviewers?.[reviewerId]
      if (reviewer) reviewer.model = model
    },
  }))

  bindings.push(
    {
      path: 'summarizer.model',
      getModel: () => config.summarizer?.model,
      setModel: (model: string) => {
        if (config.summarizer) config.summarizer.model = model
      },
    },
    {
      path: 'analyzer.model',
      getModel: () => config.analyzer?.model,
      setModel: (model: string) => {
        if (config.analyzer) config.analyzer.model = model
      },
    },
    {
      path: 'capabilities.loop.planner_model',
      getModel: () => config.capabilities.loop?.planner_model,
      setModel: (model: string) => {
        if (config.capabilities.loop) config.capabilities.loop.planner_model = model
      },
    },
    {
      path: 'capabilities.loop.executor_model',
      getModel: () => config.capabilities.loop?.executor_model,
      setModel: (model: string) => {
        if (config.capabilities.loop) config.capabilities.loop.executor_model = model
      },
    },
    {
      path: 'capabilities.issue_fix.planner_model',
      getModel: () => config.capabilities.issue_fix?.planner_model,
      setModel: (model: string) => {
        if (config.capabilities.issue_fix) config.capabilities.issue_fix.planner_model = model
      },
    },
    {
      path: 'capabilities.issue_fix.executor_model',
      getModel: () => config.capabilities.issue_fix?.executor_model,
      setModel: (model: string) => {
        if (config.capabilities.issue_fix) config.capabilities.issue_fix.executor_model = model
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

export function selectHarnessProviders(
  config: MagpieConfigV2,
  reviewerIds: string[],
  cwd: string,
  now: Date = new Date()
): HarnessProviderSelectionResult {
  const bindings = collectModelBindings(config, reviewerIds)
  const claudeBindings = bindings.filter(binding => binding.getModel() === CLAUDE_MODEL)

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

  record.kiroCheck = checkKiro(cwd)
  if (!record.kiroCheck.ok) {
    record.decision = 'fallback_failed'
    return { record }
  }

  for (const binding of claudeBindings) {
    binding.setModel(KIRO_MODEL)
    record.replacements.push(binding.path)
  }

  record.decision = 'fallback_to_kiro'
  return { record }
}

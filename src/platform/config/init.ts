import { writeFileSync, mkdirSync, existsSync, renameSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { parse, stringify } from 'yaml'
import { CURRENT_CONFIG_VERSION } from './loader.js'

export interface ReviewerOption {
  id: string
  name: string
  model: string
  description: string
  needsApiKey: boolean
  provider?: 'anthropic' | 'openai' | 'google'
}

export interface InitNotificationsOptions {
  feishuWebhookUrl?: string
  feishuWebhookSecret?: string
  imessageAppleScriptTargets?: string[]
  imessageBluebubblesServerUrl?: string
  imessageBluebubblesPassword?: string
  imessageBluebubblesChatGuid?: string
}

export type InitPlanningProviderId = 'jira_main' | 'feishu_project'
export type InitJiraAuthMode = 'cloud' | 'basic'

export interface InitPlanningOptions {
  enabled?: boolean
  defaultProvider?: InitPlanningProviderId
  jiraBaseUrl?: string
  jiraProjectKey?: string
  jiraAuthMode?: InitJiraAuthMode
  jiraEmail?: string
  jiraApiToken?: string
  jiraUsername?: string
  jiraPassword?: string
  feishuBaseUrl?: string
  feishuProjectKey?: string
  feishuAppId?: string
  feishuAppSecret?: string
}

export interface InitOperationsOptions {
  enabled?: boolean
  defaultProvider?: string
  timeoutMs?: number
  maxBufferBytes?: number
}

export interface InitConfigOptions {
  notifications?: InitNotificationsOptions
  planning?: InitPlanningOptions
  operations?: InitOperationsOptions
}

export interface InitConfigResult {
  configPath: string
  backupPath?: string
  written?: boolean
  changes?: string[]
  warnings?: string[]
  content?: string
}

export interface ConfigWriteOptions {
  configPath?: string
  dryRun?: boolean
}

export const AVAILABLE_REVIEWERS: ReviewerOption[] = [
  { id: 'claude-code', name: 'Claude Code', model: 'claude-code', description: 'Uses your Claude Code subscription (no API key needed)', needsApiKey: false },
  { id: 'codex', name: 'Codex CLI', model: 'codex', description: 'Uses your OpenAI Codex CLI subscription (no API key needed)', needsApiKey: false },
  { id: 'claw', name: 'Claw CLI', model: 'claw', description: 'Uses your Claw CLI subscription (no API key needed)', needsApiKey: false },
  { id: 'gemini-cli', name: 'Gemini CLI', model: 'gemini-cli', description: 'Uses your Gemini CLI (Google account, no API key needed)', needsApiKey: false },
  { id: 'kiro', name: 'Kiro CLI', model: 'kiro', description: 'Uses your Kiro CLI subscription (AWS, no API key needed)', needsApiKey: false },
  { id: 'claude-api', name: 'Claude Sonnet 4.5', model: 'claude-sonnet-4-5-20250514', description: 'Uses Anthropic API (requires ANTHROPIC_API_KEY)', needsApiKey: true, provider: 'anthropic' },
  { id: 'gpt', name: 'GPT-5.2', model: 'gpt-5.2', description: 'Uses OpenAI API (requires OPENAI_API_KEY)', needsApiKey: true, provider: 'openai' },
  { id: 'gemini', name: 'Gemini 3 Pro', model: 'gemini-3-pro', description: 'Uses Google AI API (requires GOOGLE_API_KEY)', needsApiKey: true, provider: 'google' },
]

const REVIEW_PROMPT = `You are a thorough code reviewer. Your job is to find ALL issues — not just the obvious ones.

      REVIEW METHOD:
      1. Use locally available sources to gather PR/MR details and diff (local git changes, existing review artifacts, or GitLab merge request pages)
      2. Go through EVERY changed file and EVERY changed function/block systematically
      3. For each change, evaluate: correctness, security, performance, error handling, edge cases, maintainability
      4. Do NOT stop after finding a few issues — exhaust every file and every change before concluding

      IMPORTANT: Do not skip any changed file. Do not gloss over any changed function.
      If a file has no issues, briefly note that you reviewed it and found nothing.

      After your analysis, output your findings as a structured JSON block:
      \`\`\`json
      {
        "issues": [
          {
            "severity": "critical|high|medium|low|nitpick",
            "category": "security|performance|error-handling|style|correctness|...",
            "file": "path/to/file.ts",
            "line": 42,
            "title": "One-line summary",
            "description": "Detailed explanation",
            "suggestedFix": "What to do about it"
          }
        ],
        "verdict": "approve|request_changes|comment",
        "summary": "Brief overall assessment"
      }
      \`\`\`
      You may include free-form discussion before the JSON block.`

const ROUTE_GEMINI_PROMPT = `You are the fast-path reviewer used for automatic routing.

Focus on:
- local correctness
- obvious omissions
- simple rollback and validation gaps

Be concise and flag only the most actionable issues.`

const ROUTE_CODEX_PROMPT = `You are the implementation-focused reviewer used for automatic routing.

Focus on:
- business logic and edge cases
- tests and verification gaps
- concrete failure modes in the current plan

Prefer specific, code-adjacent criticism over broad strategy.`

const ROUTE_ARCHITECT_PROMPT = `You are the architecture reviewer used for automatic routing.

Focus on:
- architecture and trade-offs
- module boundaries and long-term maintainability
- rollout, compatibility, security, and performance risk

Call out system-level consequences, not low-level nits.`

const REVIEW_COMMAND_WARNING = 'Review repo-specific verification commands before applying this config to a non-Node repository.'

function buildDefaultRoutingConfig() {
  return {
    enabled: true,
    strategy: 'rules_first',
    default_tier: 'standard',
    allow_runtime_escalation: true,
    thresholds: {
      simple_max: 2,
      standard_max: 5,
      complex_min: 6,
    },
    reviewer_pools: {
      simple: ['route-gemini', 'route-codex'],
      standard: ['route-codex', 'route-architect'],
      complex: ['route-gemini', 'route-codex', 'route-architect'],
    },
    stage_policies: {
      planning: {
        simple: { tool: 'gemini' },
        standard: { tool: 'codex' },
        complex: { tool: 'kiro', agent: 'architect' },
      },
      execution: {
        simple: { tool: 'gemini' },
        standard: { tool: 'codex' },
        complex: { tool: 'kiro', agent: 'dev' },
      },
    },
    fallback_chain: {
      planning: {
        simple: [{ tool: 'codex' }],
        standard: [{ tool: 'gemini' }],
        complex: [{ tool: 'codex' }, { tool: 'gemini' }],
      },
      execution: {
        simple: [{ tool: 'codex' }],
        standard: [{ tool: 'gemini' }],
        complex: [{ tool: 'codex' }, { tool: 'gemini' }],
      },
    },
  }
}

function buildRouteReviewerDefaults() {
  return {
    'route-gemini': {
      tool: 'gemini',
      prompt: ROUTE_GEMINI_PROMPT,
    },
    'route-codex': {
      tool: 'codex',
      prompt: ROUTE_CODEX_PROMPT,
    },
    'route-architect': {
      tool: 'kiro',
      agent: 'architect',
      prompt: ROUTE_ARCHITECT_PROMPT,
    },
  }
}

function buildDefaultNotificationsConfig() {
  return {
    enabled: false,
    default_timeout_ms: 5000,
    stage_ai: {
      enabled: false,
      provider: 'codex',
      timeout_ms: 2000,
      max_summary_chars: 900,
      include_loop: true,
      include_harness: true,
    },
    routes: {
      stage_entered: ['feishu_team'],
      stage_completed: ['feishu_team'],
      stage_failed: ['feishu_team'],
      stage_paused: ['feishu_team'],
      stage_resumed: ['feishu_team'],
      human_confirmation_required: ['macos_local', 'feishu_team'],
      loop_failed: ['feishu_team'],
      loop_completed: ['feishu_team'],
      loop_auto_mr_created: ['feishu_team'],
      loop_auto_mr_manual_follow_up: ['feishu_team'],
    },
  }
}

function buildDefaultImConfig() {
  return {
    enabled: false,
    default_provider: 'feishu_main',
  }
}

function buildDefaultHarnessConfig(defaultReviewers: string[]) {
  return {
    default_reviewers: defaultReviewers,
    validator_checks: [
      { tool: 'claw' },
      { tool: 'kiro' },
    ],
  }
}

function buildDefaultLoopExecutionTimeoutConfig() {
  return {
    default_ms: 900000,
    min_ms: 300000,
    max_ms: 3600000,
    complexity_multiplier: {
      simple: 1,
      standard: 2,
      complex: 3,
    },
  }
}

function buildDefaultLoopMrConfig() {
  return {
    enabled: false,
  }
}

function buildDefaultLoopHumanConfirmationConfig() {
  return {
    file: 'human_confirmation.md',
    gate_policy: 'multi_model',
    poll_interval_sec: 8,
    max_model_revisions: 1,
  }
}

function indentBlock(text: string, spaces = 6): string {
  const prefix = ' '.repeat(spaces)
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function yamlStringOrEnvRef(value: string): string {
  return value.startsWith('${') && value.endsWith('}') ? value : yamlDoubleQuoted(value)
}

function bindingFromModel(model: string, agent?: string): { tool?: string; model?: string; agent?: string } {
  if (model === 'claude-code') return { tool: 'claude', ...(agent ? { agent } : {}) }
  if (model === 'gemini-cli') return { tool: 'gemini', ...(agent ? { agent } : {}) }
  if (model === 'codex') return { tool: 'codex', ...(agent ? { agent } : {}) }
  if (model === 'kiro') return { tool: 'kiro', ...(agent ? { agent } : {}) }
  if (model === 'claw') return { tool: 'claw', ...(agent ? { agent } : {}) }
  return { model, ...(agent ? { agent } : {}) }
}

function formatBindingLines(binding: { tool?: string; model?: string; agent?: string }, spaces = 4): string {
  const prefix = ' '.repeat(spaces)
  const lines: string[] = []
  if (binding.tool) lines.push(`${prefix}tool: ${binding.tool}`)
  if (binding.model) lines.push(`${prefix}model: ${binding.model}`)
  if (binding.agent) lines.push(`${prefix}agent: ${binding.agent}`)
  return lines.join('\n')
}

function normalizeBluebubblesTarget(target: string): string {
  return target.startsWith('chat_guid:') ? target : `chat_guid:${target}`
}

function resolveNotificationsOptions(options?: InitConfigOptions) {
  const notifications = options?.notifications
  const feishuWebhookUrl = notifications?.feishuWebhookUrl?.trim() || '${FEISHU_WEBHOOK_URL}'
  const feishuWebhookSecret = notifications?.feishuWebhookSecret?.trim() || '${FEISHU_WEBHOOK_SECRET}'
  const imessageBluebubblesServerUrl = notifications?.imessageBluebubblesServerUrl?.trim() || '${BLUEBUBBLES_SERVER_URL}'
  const imessageBluebubblesPassword = notifications?.imessageBluebubblesPassword?.trim() || '${BLUEBUBBLES_PASSWORD}'
  const imessageBluebubblesTarget = normalizeBluebubblesTarget(
    notifications?.imessageBluebubblesChatGuid?.trim() || '${BLUEBUBBLES_CHAT_GUID}'
  )
  const imessageAppleScriptTargets = notifications?.imessageAppleScriptTargets?.map(target => target.trim()).filter(Boolean)

  return {
    feishuWebhookUrl,
    feishuWebhookSecret,
    imessageAppleScriptTargets: imessageAppleScriptTargets?.length ? imessageAppleScriptTargets : ['handle:+8613800138000'],
    imessageBluebubblesServerUrl,
    imessageBluebubblesPassword,
    imessageBluebubblesTarget,
  }
}

function resolvePlanningOptions(options?: InitConfigOptions) {
  const planning = options?.planning
  const jiraAuthMode = planning?.jiraAuthMode === 'basic' ? 'basic' : 'cloud'

  return {
    enabled: planning?.enabled ?? false,
    defaultProvider: planning?.defaultProvider || 'jira_main',
    jiraBaseUrl: planning?.jiraBaseUrl?.trim() || 'https://your-company.atlassian.net',
    jiraProjectKey: planning?.jiraProjectKey?.trim() || 'ENG',
    jiraAuthMode,
    jiraEmail: planning?.jiraEmail?.trim() || '${JIRA_EMAIL}',
    jiraApiToken: planning?.jiraApiToken?.trim() || '${JIRA_API_TOKEN}',
    jiraUsername: planning?.jiraUsername?.trim() || '${JIRA_USERNAME}',
    jiraPassword: planning?.jiraPassword?.trim() || '${JIRA_PASSWORD}',
    feishuBaseUrl: planning?.feishuBaseUrl?.trim() || 'https://project.feishu.cn',
    feishuProjectKey: planning?.feishuProjectKey?.trim() || 'ENG',
    feishuAppId: planning?.feishuAppId?.trim() || '${FEISHU_PROJECT_APP_ID}',
    feishuAppSecret: planning?.feishuAppSecret?.trim() || '${FEISHU_PROJECT_APP_SECRET}',
  }
}

function resolveOperationsOptions(options?: InitConfigOptions) {
  const operations = options?.operations

  return {
    enabled: operations?.enabled ?? false,
    defaultProvider: operations?.defaultProvider?.trim() || 'local_main',
    timeoutMs: operations?.timeoutMs ?? 600000,
    maxBufferBytes: operations?.maxBufferBytes ?? 10485760,
  }
}

function resolveConfigPath(baseDir?: string, configPath?: string): string {
  if (configPath) {
    return resolve(configPath)
  }

  const base = baseDir || homedir()
  return join(base, '.magpie', 'config.yaml')
}

function writeConfigContent(configPath: string, content: string, dryRun = false): Pick<InitConfigResult, 'backupPath' | 'written' | 'content'> {
  if (dryRun) {
    return {
      written: false,
      content,
    }
  }

  mkdirSync(dirname(configPath), { recursive: true })
  let backupPath: string | undefined
  if (existsSync(configPath)) {
    backupPath = buildBackupPath(configPath)
    renameSync(configPath, backupPath)
  }

  writeFileSync(configPath, content, 'utf-8')
  return {
    backupPath,
    written: true,
    content,
  }
}

function isObjectRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeMissing(target: Record<string, any>, defaults: Record<string, any>): boolean {
  let changed = false

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) {
      target[key] = value
      changed = true
      continue
    }

    if (isObjectRecord(target[key]) && isObjectRecord(value)) {
      if (deepMergeMissing(target[key], value)) {
        changed = true
      }
    }
  }

  return changed
}

function upgradeCodexBinding(binding: Record<string, any> | undefined, path: string, changes: string[]): void {
  if (!binding) return

  if (binding.model === 'codex-cli') {
    delete binding.model
    binding.tool = 'codex'
    changes.push(`Converted ${path} from model: codex-cli to tool: codex.`)
  }

  if (binding.tool === 'codex-cli') {
    binding.tool = 'codex'
    changes.push(`Converted ${path} from tool: codex-cli to tool: codex.`)
  }
}

function upgradeCodexModelField(target: Record<string, any> | undefined, field: string, path: string, changes: string[]): void {
  if (!target || target[field] !== 'codex-cli') return
  target[field] = 'codex'
  changes.push(`Converted ${path} from codex-cli to codex.`)
}

function upgradeCodexBindingList(bindings: unknown, path: string, changes: string[]): void {
  if (!Array.isArray(bindings)) {
    return
  }

  bindings.forEach((binding, index) => {
    if (isObjectRecord(binding)) {
      upgradeCodexBinding(binding, `${path}[${index}]`, changes)
    }
  })
}

function upgradeRoutingBindings(routing: Record<string, any> | undefined, changes: string[]): void {
  if (!isObjectRecord(routing)) {
    return
  }

  for (const stage of ['planning', 'execution']) {
    const stagePolicies = routing.stage_policies?.[stage]
    if (isObjectRecord(stagePolicies)) {
      for (const tier of ['simple', 'standard', 'complex']) {
        const binding = stagePolicies[tier]
        if (isObjectRecord(binding)) {
          upgradeCodexBinding(binding, `capabilities.routing.stage_policies.${stage}.${tier}`, changes)
        }
      }
    }

    const fallbackBindings = routing.fallback_chain?.[stage]
    if (isObjectRecord(fallbackBindings)) {
      for (const tier of ['simple', 'standard', 'complex']) {
        upgradeCodexBindingList(
          fallbackBindings[tier],
          `capabilities.routing.fallback_chain.${stage}.${tier}`,
          changes
        )
      }
    }
  }
}

function upgradeExistingConfig(content: string): { content: string; changes: string[]; warnings: string[] } {
  const parsed = parse(content) as Record<string, any> | null
  if (!isObjectRecord(parsed)) {
    throw new Error('Config upgrade expects a YAML object at the top level.')
  }
  if (!('capabilities' in parsed) || !('integrations' in parsed)) {
    throw new Error('Config upgrade currently supports v2 configs only. Run `magpie init` to regenerate older configs.')
  }

  const upgraded = structuredClone(parsed) as Record<string, any>
  const changes: string[] = []
  const warnings = [REVIEW_COMMAND_WARNING]
  if (upgraded.config_version !== CURRENT_CONFIG_VERSION) {
    upgraded.config_version = CURRENT_CONFIG_VERSION
    changes.push(`Set config_version to ${CURRENT_CONFIG_VERSION}.`)
  }
  const reviewers = isObjectRecord(upgraded.reviewers) ? upgraded.reviewers : {}
  upgraded.reviewers = reviewers

  for (const [id, reviewer] of Object.entries(reviewers)) {
    if (isObjectRecord(reviewer)) {
      upgradeCodexBinding(reviewer, `reviewers.${id}`, changes)
    }
  }

  if (isObjectRecord(upgraded.analyzer)) {
    upgradeCodexBinding(upgraded.analyzer, 'analyzer', changes)
  }
  if (isObjectRecord(upgraded.summarizer)) {
    upgradeCodexBinding(upgraded.summarizer, 'summarizer', changes)
  }

  const routeReviewers = buildRouteReviewerDefaults()
  for (const [id, reviewer] of Object.entries(routeReviewers)) {
    if (!reviewers[id]) {
      reviewers[id] = reviewer
      changes.push(`Added reviewers.${id} default binding.`)
    }
  }

  const capabilities = isObjectRecord(upgraded.capabilities) ? upgraded.capabilities : {}
  upgraded.capabilities = capabilities
  const nonRouteReviewerIds = Object.keys(reviewers).filter(id => !id.startsWith('route-'))
  const fallbackReviewerIds = nonRouteReviewerIds.length > 0
    ? nonRouteReviewerIds
    : Object.keys(reviewers).slice(0, 2)
  const upgradeDefaultReviewerIds = (
    Array.isArray(capabilities.review?.reviewers) && capabilities.review.reviewers.length > 0
      ? [...capabilities.review.reviewers]
      : fallbackReviewerIds.slice(0, 2)
  )
  const upgradeHarnessDefaults = buildDefaultHarnessConfig(
    upgradeDefaultReviewerIds
  )

  const integrations = isObjectRecord(upgraded.integrations) ? upgraded.integrations : {}
  upgraded.integrations = integrations
  if (!isObjectRecord(integrations.notifications)) {
    integrations.notifications = buildDefaultNotificationsConfig()
    changes.push('Added integrations.notifications defaults.')
  } else if (deepMergeMissing(integrations.notifications, buildDefaultNotificationsConfig())) {
    changes.push('Filled missing integrations.notifications defaults.')
  }

  if (!isObjectRecord(integrations.im)) {
    integrations.im = buildDefaultImConfig()
    changes.push('Added integrations.im defaults.')
  } else if (deepMergeMissing(integrations.im, buildDefaultImConfig())) {
    changes.push('Filled missing integrations.im defaults.')
  }

  if (!isObjectRecord(capabilities.routing)) {
    capabilities.routing = buildDefaultRoutingConfig()
    changes.push('Added capabilities.routing defaults.')
  } else if (deepMergeMissing(capabilities.routing, buildDefaultRoutingConfig())) {
    changes.push('Filled missing capabilities.routing defaults.')
  }
  const upgradeDiscussDefaults = {
    enabled: true,
    max_rounds: 5,
    check_convergence: true,
    reviewers: upgradeDefaultReviewerIds,
  }
  if (!isObjectRecord(capabilities.discuss)) {
    capabilities.discuss = upgradeDiscussDefaults
    changes.push('Added capabilities.discuss defaults.')
  } else if (deepMergeMissing(capabilities.discuss, upgradeDiscussDefaults)) {
    changes.push('Filled missing capabilities.discuss defaults.')
  }
  if (!isObjectRecord(capabilities.harness)) {
    capabilities.harness = upgradeHarnessDefaults
    changes.push('Added capabilities.harness defaults.')
  } else if (deepMergeMissing(capabilities.harness, upgradeHarnessDefaults)) {
    changes.push('Filled missing capabilities.harness defaults.')
  }
  if (!isObjectRecord(capabilities.loop)) {
    capabilities.loop = {
      execution_timeout: buildDefaultLoopExecutionTimeoutConfig(),
      mr: buildDefaultLoopMrConfig(),
      human_confirmation: buildDefaultLoopHumanConfirmationConfig(),
    }
    changes.push('Added capabilities.loop execution timeout defaults.')
    changes.push('Added capabilities.loop MR defaults.')
    changes.push('Added capabilities.loop human confirmation defaults.')
  } else {
    if (deepMergeMissing(capabilities.loop, { execution_timeout: buildDefaultLoopExecutionTimeoutConfig() })) {
      changes.push('Filled missing capabilities.loop execution timeout defaults.')
    }
    if (deepMergeMissing(capabilities.loop, { mr: buildDefaultLoopMrConfig() })) {
      changes.push('Added capabilities.loop MR defaults.')
    }
    if (deepMergeMissing(capabilities.loop, { human_confirmation: buildDefaultLoopHumanConfirmationConfig() })) {
      changes.push('Added capabilities.loop human confirmation defaults.')
    }
  }
  upgradeRoutingBindings(isObjectRecord(capabilities.routing) ? capabilities.routing : undefined, changes)

  if (isObjectRecord(capabilities.issue_fix)) {
    upgradeCodexModelField(capabilities.issue_fix, 'planner_model', 'capabilities.issue_fix.planner_model', changes)
    upgradeCodexModelField(capabilities.issue_fix, 'executor_model', 'capabilities.issue_fix.executor_model', changes)
  }
  if (isObjectRecord(capabilities.loop)) {
    upgradeCodexModelField(capabilities.loop, 'planner_model', 'capabilities.loop.planner_model', changes)
    upgradeCodexModelField(capabilities.loop, 'executor_model', 'capabilities.loop.executor_model', changes)
    const commands = isObjectRecord(capabilities.loop.commands) ? capabilities.loop.commands : undefined
    if (typeof commands?.integration_test === 'string' && commands.integration_test.trim() === 'npm run test:run -- tests/integration') {
      commands.integration_test = 'npm run test:run -- tests/e2e'
      changes.push('Updated capabilities.loop.commands.integration_test to the e2e default.')
    }
  }
  if (isObjectRecord(capabilities.quality) && isObjectRecord(capabilities.quality.unitTestEval)) {
    upgradeCodexModelField(capabilities.quality.unitTestEval, 'provider', 'capabilities.quality.unitTestEval.provider', changes)
  }
  if (isObjectRecord(capabilities.docs_sync)) {
    upgradeCodexModelField(capabilities.docs_sync, 'reviewer_model', 'capabilities.docs_sync.reviewer_model', changes)
  }
  if (isObjectRecord(capabilities.post_merge_regression)) {
    upgradeCodexModelField(capabilities.post_merge_regression, 'evaluator_model', 'capabilities.post_merge_regression.evaluator_model', changes)
  }

  return {
    content: stringify(upgraded),
    changes,
    warnings,
  }
}

export function generateConfig(selectedReviewerIds: string[], options?: InitConfigOptions): string {
  const selectedReviewers = AVAILABLE_REVIEWERS.filter(r => selectedReviewerIds.includes(r.id))
  const needsAnthropic = selectedReviewers.some(r => r.provider === 'anthropic')
  const needsOpenai = selectedReviewers.some(r => r.provider === 'openai')
  const needsGoogle = selectedReviewers.some(r => r.provider === 'google')

  let providersSection = '# AI Provider API Keys (use environment variables)\nproviders:'
  if (needsAnthropic) providersSection += `\n  anthropic:\n    api_key: \${ANTHROPIC_API_KEY}`
  if (needsOpenai) providersSection += `\n  openai:\n    api_key: \${OPENAI_API_KEY}`
  if (needsGoogle) providersSection += `\n  google:\n    api_key: \${GOOGLE_API_KEY}`
  if (!needsAnthropic && !needsOpenai && !needsGoogle) providersSection += ' {}'

  let reviewersSection = '# Reviewer configurations\nreviewers:'
  for (const reviewer of selectedReviewers) {
    const reviewerAgentLine = reviewer.model === 'kiro'
      ? `\n    # agent: ${reviewer.id}`
      : ''
    reviewersSection += `\n  ${reviewer.id}:\n${formatBindingLines(bindingFromModel(reviewer.model), 4)}${reviewerAgentLine}\n    prompt: |\n${indentBlock(REVIEW_PROMPT)}`
  }

  reviewersSection += `\n  route-gemini:\n${formatBindingLines({ tool: 'gemini' }, 4)}\n    prompt: |\n${indentBlock(ROUTE_GEMINI_PROMPT)}`
  reviewersSection += `\n  route-codex:\n${formatBindingLines({ tool: 'codex' }, 4)}\n    prompt: |\n${indentBlock(ROUTE_CODEX_PROMPT)}`
  reviewersSection += `\n  route-architect:\n${formatBindingLines({ tool: 'kiro', agent: 'architect' }, 4)}\n    prompt: |\n${indentBlock(ROUTE_ARCHITECT_PROMPT)}`

  const analyzerModel = selectedReviewers[0]?.model || 'claude-code'
  const analyzerBinding = bindingFromModel(analyzerModel)
  const defaultReviewers = selectedReviewers.slice(0, 2).map(r => r.id)
  if (defaultReviewers.length === 0) defaultReviewers.push('claude-code', 'codex')
  const harnessDefaults = buildDefaultHarnessConfig(defaultReviewers)

  const notifications = resolveNotificationsOptions(options)
  const planning = resolvePlanningOptions(options)
  const operations = resolveOperationsOptions(options)
  const jiraCredentialLines = planning.jiraAuthMode === 'basic'
    ? `        username: ${yamlStringOrEnvRef(planning.jiraUsername)}
        password: ${yamlStringOrEnvRef(planning.jiraPassword)}`
    : `        email: ${yamlStringOrEnvRef(planning.jiraEmail)}
        api_token: ${yamlStringOrEnvRef(planning.jiraApiToken)}`
  const appleScriptTargetsYaml = notifications.imessageAppleScriptTargets
    .map(target => `          - ${yamlDoubleQuoted(target)}`)
    .join('\n')

  return `# Magpie Configuration

config_version: ${CURRENT_CONFIG_VERSION}

${providersSection}

# Default settings
defaults:
  max_rounds: 5
  output_format: markdown
  check_convergence: true  # Stop early when reviewers reach consensus

${reviewersSection}

# Analyzer configuration - runs before debate to provide context
analyzer:
${formatBindingLines(analyzerBinding, 2)}
  prompt: |
    You are a senior engineer providing PR context analysis.
    Before the review debate begins, analyze this PR and provide:

    1. **What this PR does** - A clear summary of the changes
    2. **Architecture/Design** - Key architectural decisions and patterns used
    3. **Purpose** - What problem this solves or what feature it adds
    4. **Trade-offs** - Any trade-offs made and why
    5. **Things to note** - Important details reviewers should pay attention to
    6. **Suggested Review Focus** - List 2-4 key areas reviewers should focus on for THIS specific PR

    Use locally available sources to get PR/MR details and diff (local git changes, existing review artifacts, or GitLab merge request pages).
    Be concise but thorough. Start your response directly with the analysis — do NOT include any preamble, thinking, or meta-commentary like "Here's my analysis" or "Let me look at this".

# Summarizer configuration
summarizer:
${formatBindingLines(analyzerBinding, 2)}
  prompt: |
    You are a neutral technical reviewer.
    Based on the anonymous reviewer summaries, provide:
    - Points of consensus
    - Points of disagreement with analysis
    - Recommended action items

# Context gatherer configuration (collects system-level context before review)
contextGatherer:
  enabled: true
  callChain:
    maxDepth: 2
    maxFilesToAnalyze: 20
  history:
    maxDays: 30
    maxPRs: 10
  docs:
    patterns:
      - docs
      - README.md
      - ARCHITECTURE.md
      - DESIGN.md
    maxSize: 50000

# TRD generation configuration (PRD Markdown -> multi-role TRD)
trd:
  default_reviewers: [${defaultReviewers.join(', ')}]
  max_rounds: 3
  language: zh
  include_project_context: true
  include_traceability: true
  output:
    same_dir_as_prd: true
    trd_suffix: ".trd.md"
    open_questions_suffix: ".open-questions.md"
  preprocess:
    chunk_chars: 6000
    max_chars: 120000
  domain:
    require_human_confirmation: true
    overview_required: true

# Capability-oriented settings
capabilities:
  review:
    enabled: true
    max_rounds: 5
    check_convergence: true
    reviewers: [${defaultReviewers.join(', ')}]
    skip_context: false
  discuss:
    enabled: true
    max_rounds: 5
    check_convergence: true
    reviewers: [${defaultReviewers.join(', ')}]
  trd:
    default_reviewers: [${defaultReviewers.join(', ')}]
    max_rounds: 3
    language: zh
    include_project_context: true
    include_traceability: true
    output:
      same_dir_as_prd: true
      trd_suffix: ".trd.md"
      open_questions_suffix: ".open-questions.md"
    preprocess:
      chunk_chars: 6000
      max_chars: 120000
    domain:
      require_human_confirmation: true
      overview_required: true
  quality:
    unitTestEval:
      enabled: true
      provider: ${analyzerModel}
      max_files: 50
      min_coverage: 0.8
      output_format: markdown
  harness:
    default_reviewers: [${harnessDefaults.default_reviewers.join(', ')}]
    validator_checks:
      - tool: ${harnessDefaults.validator_checks[0].tool}
      - tool: ${harnessDefaults.validator_checks[1].tool}
  issue_fix:
    enabled: true
    planner_model: ${analyzerModel}
    executor_model: codex
    verify_command: "npm run test:run"
    auto_commit: false
  routing:
    enabled: true
    strategy: "rules_first"
    default_tier: "standard"
    allow_runtime_escalation: true
    thresholds:
      simple_max: 2
      standard_max: 5
      complex_min: 6
    reviewer_pools:
      simple: [route-gemini, route-codex]
      standard: [route-codex, route-architect]
      complex: [route-gemini, route-codex, route-architect]
    stage_policies:
      planning:
        simple:
          tool: gemini
        standard:
          tool: codex
        complex:
          tool: kiro
          agent: architect
      execution:
        simple:
          tool: gemini
        standard:
          tool: codex
        complex:
          tool: kiro
          agent: dev
    fallback_chain:
      planning:
        simple:
          - tool: codex
        standard:
          - tool: gemini
        complex:
          - tool: codex
          - tool: gemini
      execution:
        simple:
          - tool: codex
        standard:
          - tool: gemini
        complex:
          - tool: codex
          - tool: gemini
  docs_sync:
    enabled: true
    reviewer_model: ${analyzerModel}
    docs_patterns: ["README.md", "docs"]
  post_merge_regression:
    enabled: true
    evaluator_model: ${analyzerModel}
    commands: ["npm run test:run", "npm run build"]
  loop:
    enabled: true
    planner_model: ${analyzerModel}
    executor_model: codex
    stages: [prd_review, domain_partition, trd_generation, code_development, unit_mock_test, integration_test]
    execution_timeout:
      default_ms: 900000
      min_ms: 300000
      max_ms: 3600000
      complexity_multiplier:
        simple: 1
        standard: 2
        complex: 3
    confidence_threshold: 0.78
    retries_per_stage: 2
    max_iterations: 30
    auto_commit: true
    reuse_current_branch: false
    auto_branch_prefix: "sch/"
    branch_naming:
      enabled: true
      tool: claw
    mr:
      enabled: false
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "multi_model"
      poll_interval_sec: 8
      max_model_revisions: 1
    commands:
      unit_test: "npm run test:run"
      # For non-Node repos, replace the legacy unit/mock commands with project-specific checks:
      # unit_mock_test_steps:
      #   - label: "Project unit tests"
      #     command: "mvn test"
      #   - label: "Shared mock checks"
      #     command: "go test ./... -run TestWithMocks"
      integration_test: "npm run test:run -- tests/integration"
      integration_test: "npm run test:run -- tests/e2e"

# Integrations
integrations:
  notifications:
    enabled: false
    default_timeout_ms: 5000
    stage_ai:
      enabled: false
      provider: "codex"
      timeout_ms: 2000
      max_summary_chars: 900
      include_loop: true
      include_harness: true
    routes:
      stage_entered: [feishu_team]
      stage_completed: [feishu_team]
      stage_failed: [feishu_team]
      stage_paused: [feishu_team]
      stage_resumed: [feishu_team]
      human_confirmation_required: [macos_local, feishu_team]
      loop_failed: [feishu_team]
      loop_completed: [feishu_team]
      loop_auto_mr_created: [feishu_team]
      loop_auto_mr_manual_follow_up: [feishu_team]
    providers:
      macos_local:
        type: "macos"
        click_target: "vscode"
        terminal_notifier_bin: "terminal-notifier"
        fallback_osascript: true
      feishu_team:
        type: "feishu-webhook"
        webhook_url: ${yamlDoubleQuoted(notifications.feishuWebhookUrl)}
        secret: ${yamlDoubleQuoted(notifications.feishuWebhookSecret)}
        msg_type: "interactive"
      imessage_local:
        type: "imessage"
        transport: "messages-applescript"
        service: "iMessage"
        targets:
${appleScriptTargetsYaml}
      imessage_remote:
        type: "imessage"
        transport: "bluebubbles"
        server_url: ${yamlDoubleQuoted(notifications.imessageBluebubblesServerUrl)}
        password: ${yamlDoubleQuoted(notifications.imessageBluebubblesPassword)}
        targets:
          - ${yamlDoubleQuoted(notifications.imessageBluebubblesTarget)}
        method: "private-api"
  planning:
    enabled: ${planning.enabled ? 'true' : 'false'}
    default_provider: ${yamlDoubleQuoted(planning.defaultProvider)}
    providers:
      jira_main:
        type: "jira"
        base_url: ${yamlDoubleQuoted(planning.jiraBaseUrl)}
        project_key: ${yamlDoubleQuoted(planning.jiraProjectKey)}
        auth_mode: ${yamlDoubleQuoted(planning.jiraAuthMode)}
${jiraCredentialLines}
      feishu_project:
        type: "feishu-project"
        base_url: ${yamlDoubleQuoted(planning.feishuBaseUrl)}
        project_key: ${yamlDoubleQuoted(planning.feishuProjectKey)}
        app_id: ${yamlStringOrEnvRef(planning.feishuAppId)}
        app_secret: ${yamlStringOrEnvRef(planning.feishuAppSecret)}
  operations:
    enabled: ${operations.enabled ? 'true' : 'false'}
    default_provider: ${yamlDoubleQuoted(operations.defaultProvider)}
    providers:
      ${operations.defaultProvider}:
        type: "local-commands"
        timeout_ms: ${operations.timeoutMs}
        max_buffer_bytes: ${operations.maxBufferBytes}
  im:
    enabled: false
    default_provider: "feishu_main"
    providers:
      feishu_main:
        type: "feishu-app"
        app_id: ${yamlStringOrEnvRef('${FEISHU_APP_ID}')}
        app_secret: ${yamlStringOrEnvRef('${FEISHU_APP_SECRET}')}
        verification_token: ${yamlStringOrEnvRef('${FEISHU_VERIFICATION_TOKEN}')}
        encrypt_key: ${yamlStringOrEnvRef('${FEISHU_ENCRYPT_KEY}')}
        default_chat_id: ${yamlStringOrEnvRef('${FEISHU_DEFAULT_CHAT_ID}')}
        approval_whitelist_open_ids:
          - "ou_xxx_operator"
        callback_port: 9321
        callback_path: "/callbacks/feishu"
`
}

export const DEFAULT_CONFIG = generateConfig(['claude-code', 'codex'])

function buildBackupPath(configPath: string): string {
  const timestamp = Date.now()
  let backupPath = `${configPath}.bak-${timestamp}`
  let suffix = 1

  while (existsSync(backupPath)) {
    backupPath = `${configPath}.bak-${timestamp}-${suffix}`
    suffix += 1
  }

  return backupPath
}

export function initConfigWithResult(baseDir?: string, selectedReviewers?: string[], options?: InitConfigOptions, writeOptions?: ConfigWriteOptions): InitConfigResult {
  const configPath = resolveConfigPath(baseDir, writeOptions?.configPath)
  const reviewerIds = selectedReviewers?.length ? selectedReviewers : ['claude-code', 'codex']
  const content = generateConfig(reviewerIds, options)
  const writeResult = writeConfigContent(configPath, content, writeOptions?.dryRun)

  return { configPath, ...writeResult }
}

export function initConfig(baseDir?: string, selectedReviewers?: string[], options?: InitConfigOptions): string {
  return initConfigWithResult(baseDir, selectedReviewers, options).configPath
}

export function upgradeConfigWithResult(configPath: string, options?: { dryRun?: boolean }): InitConfigResult {
  const resolvedPath = resolveConfigPath(undefined, configPath)
  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`)
  }

  const current = readFileSync(resolvedPath, 'utf-8')
  const upgraded = upgradeExistingConfig(current)
  const writeResult = writeConfigContent(resolvedPath, upgraded.content, options?.dryRun)

  return {
    configPath: resolvedPath,
    changes: upgraded.changes,
    warnings: upgraded.warnings,
    ...writeResult,
  }
}

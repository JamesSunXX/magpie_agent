import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'
import { getMagpieHomeDir } from '../paths.js'
import { logger } from '../../shared/utils/logger.js'
import { getProviderForModel, getProviderForTool } from '../../providers/factory.js'
import type {
  MagpieConfigV2,
  ReviewerConfig,
  RoutingConfig,
  ReviewerPoolPolicy,
  ModelRouteBinding,
  TrdConfig,
  HarnessConfig,
  LoopCommandsConfig,
  LoopExecutionTimeoutConfig,
  LoopStageName,
  LoopConfig,
  LoopStageBindingConfig,
  LoopStageBindingsConfig,
} from './types.js'

const ROUTE_REVIEWER_PROMPT = 'You are a senior technical reviewer. Focus on trade-offs, risk, correctness, and practical next steps.'
export const CURRENT_CONFIG_VERSION = 19
const LEGACY_INTEGRATION_TEST_COMMAND = 'npm run test:run -- tests/integration'
const DEFAULT_INTEGRATION_TEST_COMMAND = 'npm run test:run -- tests/e2e'
const LOOP_STAGE_NAMES: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
]
const LOOP_STAGE_BINDING_KEYS = ['primary', 'reviewer', 'rescue'] as const

export interface ConfigVersionStatus {
  path: string
  configVersion?: number
  expectedVersion: number
  state: 'current' | 'outdated' | 'newer'
  message?: string
}

function ensureBuiltInRouteReviewers(config: MagpieConfigV2): void {
  const reviewers = config.reviewers || {}

  if (!reviewers['route-gemini']) {
    reviewers['route-gemini'] = {
      tool: 'gemini',
      prompt: ROUTE_REVIEWER_PROMPT,
    }
  }

  if (!reviewers['route-codex']) {
    reviewers['route-codex'] = {
      tool: 'codex',
      prompt: ROUTE_REVIEWER_PROMPT,
    }
  }

  if (!reviewers['route-architect']) {
    reviewers['route-architect'] = {
      tool: 'kiro',
      agent: 'architect',
      prompt: ROUTE_REVIEWER_PROMPT,
    }
  }

  config.reviewers = reviewers
}

function validateReviewerPool(name: string, pool: string[] | undefined, reviewers: Record<string, ReviewerConfig>): void {
  if (!pool) return
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`Config error: ${name} must be a non-empty array`)
  }

  for (const id of pool) {
    if (!reviewers[id]) {
      throw new Error(`Config error: ${name} includes unknown reviewer "${id}"`)
    }
  }
}

function validateReviewerIdArray(name: string, ids: string[] | undefined, reviewers: Record<string, ReviewerConfig>): void {
  if (ids === undefined) return
  if (!Array.isArray(ids)) {
    throw new Error(`Config error: ${name} must be an array`)
  }

  for (const id of ids) {
    if (!reviewers[id]) {
      throw new Error(`Config error: ${name} includes unknown reviewer "${id}"`)
    }
  }
}

function validateRoutingConfig(routing: RoutingConfig | undefined, reviewers: Record<string, ReviewerConfig>): void {
  if (!routing) return

  const pools = routing.reviewer_pools as ReviewerPoolPolicy | undefined
  validateReviewerPool('capabilities.routing.reviewer_pools.simple', pools?.simple, reviewers)
  validateReviewerPool('capabilities.routing.reviewer_pools.standard', pools?.standard, reviewers)
  validateReviewerPool('capabilities.routing.reviewer_pools.complex', pools?.complex, reviewers)

  validateBinding('capabilities.routing.stage_policies.planning.simple', routing.stage_policies?.planning?.simple)
  validateBinding('capabilities.routing.stage_policies.planning.standard', routing.stage_policies?.planning?.standard)
  validateBinding('capabilities.routing.stage_policies.planning.complex', routing.stage_policies?.planning?.complex)
  validateBinding('capabilities.routing.stage_policies.execution.simple', routing.stage_policies?.execution?.simple)
  validateBinding('capabilities.routing.stage_policies.execution.standard', routing.stage_policies?.execution?.standard)
  validateBinding('capabilities.routing.stage_policies.execution.complex', routing.stage_policies?.execution?.complex)

  const fallbackChain = routing.fallback_chain
  validateFallbackBindings('capabilities.routing.fallback_chain.planning.simple', fallbackChain?.planning?.simple)
  validateFallbackBindings('capabilities.routing.fallback_chain.planning.standard', fallbackChain?.planning?.standard)
  validateFallbackBindings('capabilities.routing.fallback_chain.planning.complex', fallbackChain?.planning?.complex)
  validateFallbackBindings('capabilities.routing.fallback_chain.execution.simple', fallbackChain?.execution?.simple)
  validateFallbackBindings('capabilities.routing.fallback_chain.execution.standard', fallbackChain?.execution?.standard)
  validateFallbackBindings('capabilities.routing.fallback_chain.execution.complex', fallbackChain?.execution?.complex)
}

function validateFallbackBindings(name: string, bindings: ModelRouteBinding[] | undefined): void {
  if (!bindings) return
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error(`Config error: ${name} must be a non-empty array`)
  }

  for (const [index, binding] of bindings.entries()) {
    validateBinding(`${name}[${index}]`, binding, `${name} entries`)
  }
}

function validateBinding(name: string, binding: Pick<ReviewerConfig, 'tool' | 'model' | 'agent'> | undefined, listEntryLabel?: string): void {
  if (!binding) return

  const tool = binding.tool?.trim()
  const model = binding.model?.trim()
  if (!tool && !model) {
    const prefix = listEntryLabel || name
    throw new Error(`Config error: ${prefix} must include a non-empty tool or model`)
  }

  if (binding.tool !== undefined) {
    if (!tool) {
      throw new Error(`Config error: ${name}.tool must be a non-empty string`)
    }
    getProviderForTool(tool)
  }

  if (binding.model !== undefined && !model) {
    throw new Error(`Config error: ${name}.model must be a non-empty string`)
  }

  validateOptionalAgent(name, binding.agent)
  if (!binding.agent) return

  const providerName = tool
    ? getProviderForTool(tool)
    : getProviderForModel(model!)
  if (providerName !== 'kiro') {
    throw new Error(`Config error: ${name}.agent is only supported when tool/model resolves to kiro`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expandEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, envVar) => process.env[envVar] || '')
}

function expandEnvVarsInObject(obj: unknown): unknown {
  if (typeof obj === 'string') return expandEnvVars(obj)
  if (Array.isArray(obj)) return obj.map(expandEnvVarsInObject)
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value)
    }
    return result
  }
  return obj
}

export function getConfigPath(customPath?: string): string {
  if (customPath) {
    return customPath
  }

  const localConfigPath = join(process.cwd(), '.magpie', 'config.yaml')
  if (existsSync(localConfigPath)) {
    return localConfigPath
  }

  return join(getMagpieHomeDir(), 'config.yaml')
}

export function getConfigVersionStatus(configPath?: string): ConfigVersionStatus {
  const path = getConfigPath(configPath)

  if (!existsSync(path)) {
    return {
      path,
      expectedVersion: CURRENT_CONFIG_VERSION,
      state: 'current',
    }
  }

  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = parse(content) as Record<string, unknown> | null
    const rawVersion = parsed && typeof parsed === 'object' ? parsed.config_version : undefined
    const configVersion = typeof rawVersion === 'number' && Number.isFinite(rawVersion)
      ? rawVersion
      : undefined

    if (configVersion === CURRENT_CONFIG_VERSION) {
      return {
        path,
        configVersion,
        expectedVersion: CURRENT_CONFIG_VERSION,
        state: 'current',
      }
    }

    if (configVersion !== undefined && configVersion > CURRENT_CONFIG_VERSION) {
      return {
        path,
        configVersion,
        expectedVersion: CURRENT_CONFIG_VERSION,
        state: 'newer',
        message: `Config version ${configVersion} is newer than this CLI expects (${CURRENT_CONFIG_VERSION}). Check whether Magpie itself needs an update before continuing.`,
      }
    }

    return {
      path,
      configVersion,
      expectedVersion: CURRENT_CONFIG_VERSION,
      state: 'outdated',
      message: `Config version is outdated or missing. Run \`magpie init --upgrade --config ${path}\` to update it.`,
    }
  } catch {
    return {
      path,
      expectedVersion: CURRENT_CONFIG_VERSION,
      state: 'current',
    }
  }
}

function validateReviewerConfig(name: string, rc: ReviewerConfig | undefined): void {
  if (!rc) {
    throw new Error(`Config error: ${name} is missing a reviewer config`)
  }
  validateBinding(name, rc)
  if (!rc.prompt || typeof rc.prompt !== 'string') {
    throw new Error(`Config error: ${name} is missing a "prompt" field`)
  }
}

function validateOptionalAgent(name: string, agent: string | undefined): void {
  if (agent === undefined) return
  if (typeof agent !== 'string' || agent.trim().length === 0) {
    throw new Error(`Config error: ${name}.agent must be a non-empty string`)
  }
}

function validateTrdConfig(trd: TrdConfig, reviewers: Record<string, ReviewerConfig>): void {
  validateReviewerIdArray('trd.default_reviewers', trd.default_reviewers, reviewers)

  if (trd.max_rounds !== undefined && trd.max_rounds <= 0) {
    throw new Error('Config error: trd.max_rounds must be > 0')
  }
}

function validateHarnessConfig(harness: HarnessConfig | undefined, reviewers: Record<string, ReviewerConfig>): void {
  if (!harness) return

  validateReviewerIdArray('capabilities.harness.default_reviewers', harness.default_reviewers, reviewers)

  if (harness.validator_checks === undefined) {
    return
  }
  if (!Array.isArray(harness.validator_checks)) {
    throw new Error('Config error: capabilities.harness.validator_checks must be an array')
  }

  harness.validator_checks.forEach((binding, index) => {
    validateBinding(`capabilities.harness.validator_checks[${index}]`, binding, 'capabilities.harness.validator_checks entries')
  })

  if (!harness.role_bindings) {
    return
  }

  validateBinding('capabilities.harness.role_bindings.developer', harness.role_bindings.developer)
  validateBinding('capabilities.harness.role_bindings.arbitrator', harness.role_bindings.arbitrator)

  if (harness.role_bindings.reviewers !== undefined) {
    if (!Array.isArray(harness.role_bindings.reviewers)) {
      throw new Error('Config error: capabilities.harness.role_bindings.reviewers must be an array')
    }

    harness.role_bindings.reviewers.forEach((binding, index) => {
      validateBinding(
        `capabilities.harness.role_bindings.reviewers[${index}]`,
        binding,
        'capabilities.harness.role_bindings.reviewers entries'
      )
    })
  }

  if (!harness.role_bindings.named_reviewers) {
    return
  }

  for (const [name, binding] of Object.entries(harness.role_bindings.named_reviewers)) {
    validateBinding(`capabilities.harness.role_bindings.named_reviewers.${name}`, binding)
  }
}

function validateLoopConfig(
  loop: LoopConfig | undefined,
  reviewers: Record<string, ReviewerConfig>,
  discussReviewers: string[] | undefined
): void {
  if (loop?.role_bindings) {
    validateBinding('capabilities.loop.role_bindings.architect', loop.role_bindings.architect)
    validateBinding('capabilities.loop.role_bindings.developer', loop.role_bindings.developer)
  }

  validateLoopStages(loop?.stages)
  validateLoopStageBindings(loop?.stage_bindings)
  validateLoopCommands(loop?.commands)

  const humanConfirmation = loop?.human_confirmation
  if (!humanConfirmation) {
    return
  }

  validateReviewerIdArray(
    'capabilities.loop.human_confirmation.reviewer_ids',
    humanConfirmation.reviewer_ids,
    reviewers
  )

  if (humanConfirmation.max_model_revisions !== undefined) {
    if (!Number.isInteger(humanConfirmation.max_model_revisions) || humanConfirmation.max_model_revisions < 0) {
      throw new Error('Config error: capabilities.loop.human_confirmation.max_model_revisions must be a non-negative integer')
    }
  }

  if (humanConfirmation.gate_policy !== 'multi_model') {
    return
  }

  const reviewerIds = humanConfirmation.reviewer_ids ?? discussReviewers
  const distinctReviewerIds = Array.isArray(reviewerIds)
    ? Array.from(new Set(reviewerIds))
    : []
  if (distinctReviewerIds.length < 2) {
    throw new Error('Config error: capabilities.loop.human_confirmation requires at least 2 distinct reviewers for multi_model gate policy')
  }
}

function validateLoopStages(stages: LoopStageName[] | undefined): void {
  if (stages === undefined) return
  if (!Array.isArray(stages)) {
    throw new Error('Config error: capabilities.loop.stages must be an array')
  }

  for (const [index, stage] of stages.entries()) {
    if (typeof stage !== 'string' || !LOOP_STAGE_NAMES.includes(stage as LoopStageName)) {
      throw new Error(`Config error: capabilities.loop.stages[${index}] must be one of ${LOOP_STAGE_NAMES.join(', ')}`)
    }
  }
}

function validateLoopStageBindings(stageBindings: LoopStageBindingsConfig | undefined): void {
  if (stageBindings === undefined) return
  if (!isRecord(stageBindings)) {
    throw new Error('Config error: capabilities.loop.stage_bindings must be an object')
  }

  for (const [stageName, bindings] of Object.entries(stageBindings)) {
    if (!LOOP_STAGE_NAMES.includes(stageName as LoopStageName)) {
      throw new Error(`Config error: capabilities.loop.stage_bindings has unknown stage "${stageName}"`)
    }
    if (!isRecord(bindings)) {
      throw new Error(`Config error: capabilities.loop.stage_bindings.${stageName} must be an object`)
    }

    for (const [bindingKey, binding] of Object.entries(bindings)) {
      if (!LOOP_STAGE_BINDING_KEYS.includes(bindingKey as (typeof LOOP_STAGE_BINDING_KEYS)[number])) {
        throw new Error(`Config error: capabilities.loop.stage_bindings.${stageName} has unknown binding key "${bindingKey}"`)
      }
      validateBinding(
        `capabilities.loop.stage_bindings.${stageName}.${bindingKey}`,
        binding as LoopStageBindingConfig[keyof LoopStageBindingConfig]
      )
    }
  }
}

function validateLoopCommands(commands: LoopCommandsConfig | undefined): void {
  if (!commands) return

  const steps = commands.unit_mock_test_steps
  if (steps === undefined) {
    return
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Config error: capabilities.loop.commands.unit_mock_test_steps must be a non-empty array')
  }

  for (const [index, step] of steps.entries()) {
    if (step === null || typeof step !== 'object') {
      throw new Error(`Config error: capabilities.loop.commands.unit_mock_test_steps[${index}] must be an object`)
    }

    if (typeof step.command !== 'string' || step.command.trim().length === 0) {
      throw new Error(`Config error: capabilities.loop.commands.unit_mock_test_steps[${index}].command must be a non-empty string`)
    }

    if (step.label !== undefined && (typeof step.label !== 'string' || step.label.trim().length === 0)) {
      throw new Error(`Config error: capabilities.loop.commands.unit_mock_test_steps[${index}].label must be a non-empty string when provided`)
    }
  }
}

function validatePositiveNumber(name: string, value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Config error: ${name} must be a positive number`)
  }
}

function validateLoopExecutionTimeout(timeout: LoopExecutionTimeoutConfig | undefined): void {
  if (!timeout) return

  validatePositiveNumber('capabilities.loop.execution_timeout.default_ms', timeout.default_ms)
  validatePositiveNumber('capabilities.loop.execution_timeout.min_ms', timeout.min_ms)
  validatePositiveNumber('capabilities.loop.execution_timeout.max_ms', timeout.max_ms)

  if (
    timeout.min_ms !== undefined
    && timeout.max_ms !== undefined
    && timeout.min_ms > timeout.max_ms
  ) {
    throw new Error('Config error: capabilities.loop.execution_timeout.min_ms must be <= max_ms')
  }

  const multipliers = timeout.complexity_multiplier
  if (multipliers) {
    validatePositiveNumber('capabilities.loop.execution_timeout.complexity_multiplier.simple', multipliers.simple)
    validatePositiveNumber('capabilities.loop.execution_timeout.complexity_multiplier.standard', multipliers.standard)
    validatePositiveNumber('capabilities.loop.execution_timeout.complexity_multiplier.complex', multipliers.complex)
  }

  const stageOverrides = timeout.stage_overrides_ms
  if (!stageOverrides) {
    return
  }

  for (const key of Object.keys(stageOverrides)) {
    if (!LOOP_STAGE_NAMES.includes(key as LoopStageName)) {
      throw new Error(`Config error: capabilities.loop.execution_timeout.stage_overrides_ms has unknown stage "${key}"`)
    }
  }

  for (const stage of LOOP_STAGE_NAMES) {
    validatePositiveNumber(`capabilities.loop.execution_timeout.stage_overrides_ms.${stage}`, stageOverrides[stage])
  }
}

function validateNotificationsConfig(config: MagpieConfigV2['integrations']['notifications'] | undefined): void {
  if (!config) return

  validatePositiveNumber('integrations.notifications.default_timeout_ms', config.default_timeout_ms)
  validatePositiveNumber('integrations.notifications.stage_ai.timeout_ms', config.stage_ai?.timeout_ms)
}

function isLegacyConfig(config: Record<string, unknown>): boolean {
  return !('capabilities' in config) && !('integrations' in config)
}

function validateConfig(config: MagpieConfigV2, raw: Record<string, unknown>): void {
  if (isLegacyConfig(raw)) {
    throw new Error(
      'Legacy config schema is no longer supported. Run `magpie init` to regenerate ~/.magpie/config.yaml with capabilities/integrations sections.'
    )
  }

  if (!('capabilities' in raw)) {
    throw new Error('Config error: capabilities section is required')
  }

  if (!('integrations' in raw)) {
    throw new Error('Config error: integrations section is required')
  }

  if (!config.defaults || config.defaults.max_rounds <= 0) {
    throw new Error('Config error: defaults.max_rounds must be > 0')
  }

  if (!config.reviewers || Object.keys(config.reviewers).length === 0) {
    throw new Error('Config error: at least one reviewer must be defined')
  }

  ensureBuiltInRouteReviewers(config)

  for (const [id, reviewer] of Object.entries(config.reviewers)) {
    validateReviewerConfig(`reviewers.${id}`, reviewer)
  }

  validateReviewerConfig('summarizer', config.summarizer)
  validateReviewerConfig('analyzer', config.analyzer)
  validateOptionalAgent('contextGatherer', config.contextGatherer?.agent)

  for (const [name, provider] of Object.entries(config.providers || {})) {
    if (provider && 'api_key' in provider && !provider.api_key) {
      logger.warn(`providers.${name}.api_key is empty (ok if using CLI provider)`)
    }
  }

  if (config.trd) {
    validateTrdConfig(config.trd, config.reviewers)
  }

  validateRoutingConfig(config.capabilities.routing, config.reviewers)
  validateLoopConfig(config.capabilities.loop, config.reviewers, config.capabilities.discuss?.reviewers)
  validateHarnessConfig(config.capabilities.harness, config.reviewers)
  validateLoopExecutionTimeout(config.capabilities.loop?.execution_timeout)
  validateNotificationsConfig(config.integrations.notifications)
}

function normalizeLegacyLoopCommands(config: MagpieConfigV2, rawVersion: number | undefined, configPath: string): void {
  const commands = config.capabilities.loop?.commands
  if (!commands) return

  if (
    rawVersion !== undefined
    && rawVersion >= CURRENT_CONFIG_VERSION
  ) {
    return
  }

  if (commands.integration_test?.trim() !== LEGACY_INTEGRATION_TEST_COMMAND) {
    return
  }

  commands.integration_test = DEFAULT_INTEGRATION_TEST_COMMAND
  logger.warn(
    `capabilities.loop.commands.integration_test used legacy default "${LEGACY_INTEGRATION_TEST_COMMAND}" and was normalized to "${DEFAULT_INTEGRATION_TEST_COMMAND}" in memory. Run \`magpie init --upgrade --config ${configPath}\` to persist the new default.`
  )
}

export function loadConfig(configPath?: string): MagpieConfigV2 {
  const path = getConfigPath(configPath)

  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`)
  }

  const content = readFileSync(path, 'utf-8')
  const parsed = parse(content) as Record<string, unknown>
  const rawVersion = typeof parsed?.config_version === 'number' ? parsed.config_version : undefined
  const expanded = expandEnvVarsInObject(parsed) as MagpieConfigV2
  if (expanded.config_version === undefined) {
    expanded.config_version = CURRENT_CONFIG_VERSION
  }

  validateConfig(expanded, parsed)
  normalizeLegacyLoopCommands(expanded, rawVersion, path)
  return expanded
}

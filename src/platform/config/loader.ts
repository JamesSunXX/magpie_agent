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
} from './types.js'

const ROUTE_REVIEWER_PROMPT = 'You are a senior technical reviewer. Focus on trade-offs, risk, correctness, and practical next steps.'

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
  return customPath || join(getMagpieHomeDir(), 'config.yaml')
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
  if (trd.default_reviewers && !Array.isArray(trd.default_reviewers)) {
    throw new Error('Config error: trd.default_reviewers must be an array')
  }

  if (trd.default_reviewers) {
    for (const id of trd.default_reviewers) {
      if (!reviewers[id]) {
        throw new Error(`Config error: trd.default_reviewers includes unknown reviewer "${id}"`)
      }
    }
  }

  if (trd.max_rounds !== undefined && trd.max_rounds <= 0) {
    throw new Error('Config error: trd.max_rounds must be > 0')
  }
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
}

export function loadConfig(configPath?: string): MagpieConfigV2 {
  const path = getConfigPath(configPath)

  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`)
  }

  const content = readFileSync(path, 'utf-8')
  const parsed = parse(content) as Record<string, unknown>
  const expanded = expandEnvVarsInObject(parsed) as MagpieConfigV2

  validateConfig(expanded, parsed)
  return expanded
}

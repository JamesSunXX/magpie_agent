import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parse } from 'yaml'
import { logger } from '../../shared/utils/logger.js'
import type { MagpieConfigV2, ReviewerConfig, TrdConfig } from './types.js'

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
  return customPath || join(homedir(), '.magpie', 'config.yaml')
}

function validateReviewerConfig(name: string, rc: ReviewerConfig | undefined): void {
  if (!rc?.model || typeof rc.model !== 'string') {
    throw new Error(`Config error: ${name} is missing a "model" field`)
  }
  if (!rc.prompt || typeof rc.prompt !== 'string') {
    throw new Error(`Config error: ${name} is missing a "prompt" field`)
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

  for (const [id, reviewer] of Object.entries(config.reviewers)) {
    validateReviewerConfig(`reviewers.${id}`, reviewer)
  }

  validateReviewerConfig('summarizer', config.summarizer)
  validateReviewerConfig('analyzer', config.analyzer)

  for (const [name, provider] of Object.entries(config.providers || {})) {
    if (provider && 'api_key' in provider && !provider.api_key) {
      logger.warn(`providers.${name}.api_key is empty (ok if using CLI provider)`)
    }
  }

  if (config.trd) {
    validateTrdConfig(config.trd, config.reviewers)
  }
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

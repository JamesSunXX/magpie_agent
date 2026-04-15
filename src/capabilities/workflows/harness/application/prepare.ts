import type { CapabilityContext } from '../../../../core/capability/context.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import type { MagpieConfigV2 } from '../../../../platform/config/types.js'
import { getProviderForTool } from '../../../../providers/factory.js'
import type { HarnessInput, HarnessPreparedInput } from '../types.js'

const DEFAULT_MODELS = ['kiro', 'codex']

function normalizeModels(models: string[] | undefined, configuredDefaults?: string[] | null): string[] {
  const value = (models || configuredDefaults || DEFAULT_MODELS)
    .map(item => item.trim())
    .filter(Boolean)
  return value.length > 0 ? value : DEFAULT_MODELS
}

function resolveProviderName(binding: { tool?: string; model?: string } | undefined): string | null {
  if (!binding) return null
  if (binding.tool) {
    return getProviderForTool(binding.tool)
  }
  return binding.model?.trim() || null
}

function resolveConfiguredHarnessModels(config: MagpieConfigV2): string[] | null {
  const defaultReviewerIds = config.capabilities.harness?.default_reviewers
  if (Array.isArray(defaultReviewerIds) && defaultReviewerIds.length > 0) {
    const models = defaultReviewerIds
      .map((reviewerId) => resolveProviderName(config.reviewers?.[reviewerId]))
      .filter((value): value is string => Boolean(value))
    if (models.length > 0) {
      return models
    }
  }

  const roleBindings = config.capabilities.harness?.role_bindings
  const configuredBindings = roleBindings?.named_reviewers
    ? Object.values(roleBindings.named_reviewers)
    : roleBindings?.reviewers
  if (Array.isArray(configuredBindings) && configuredBindings.length > 0) {
    const models = configuredBindings
      .map((binding) => resolveProviderName(binding))
      .filter((value): value is string => Boolean(value))
    if (models.length > 0) {
      return models
    }
  }

  return null
}

export async function prepareHarnessInput(
  input: HarnessInput,
  ctx: CapabilityContext
): Promise<HarnessPreparedInput> {
  const modelsExplicit = typeof input.modelsExplicit === 'boolean'
    ? input.modelsExplicit
    : Array.isArray(input.models) && input.models.length > 0
  const config = ctx.configPath ? loadConfig(ctx.configPath) : undefined
  const configuredModels = modelsExplicit || !config ? null : resolveConfiguredHarnessModels(config)
  return {
    ...input,
    preparedAt: new Date(),
    maxCycles: Number.isFinite(input.maxCycles) ? Math.max(1, input.maxCycles as number) : 3,
    reviewRounds: Number.isFinite(input.reviewRounds) ? Math.max(1, input.reviewRounds as number) : 3,
    models: normalizeModels(input.models, configuredModels),
    modelsExplicit,
    ...(config ? { config } : {}),
  }
}

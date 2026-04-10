import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { HarnessInput, HarnessPreparedInput } from '../types.js'

const DEFAULT_MODELS = ['gemini-cli', 'kiro']

function normalizeModels(models: string[] | undefined): string[] {
  const value = (models || DEFAULT_MODELS)
    .map(item => item.trim())
    .filter(Boolean)
  return value.length > 0 ? value : DEFAULT_MODELS
}

export async function prepareHarnessInput(
  input: HarnessInput,
  _ctx: CapabilityContext
): Promise<HarnessPreparedInput> {
  const modelsExplicit = Array.isArray(input.models) && input.models.length > 0
  return {
    ...input,
    preparedAt: new Date(),
    maxCycles: Number.isFinite(input.maxCycles) ? Math.max(1, input.maxCycles as number) : 3,
    reviewRounds: Number.isFinite(input.reviewRounds) ? Math.max(1, input.reviewRounds as number) : 3,
    models: normalizeModels(input.models),
    modelsExplicit,
  }
}

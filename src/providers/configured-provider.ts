import type { MagpieConfig } from '../config/types.js'
import type { AIProvider } from './types.js'
import { createProvider, getProviderForModel } from './factory.js'

export interface ProviderBindingInput {
  logicalName: string
  model: string
  agent?: string
}

export interface ProviderBinding {
  logicalName: string
  model: string
  agent?: string
}

export function resolveProviderBinding(input: ProviderBindingInput): ProviderBinding {
  const providerName = getProviderForModel(input.model)
  if (providerName !== 'kiro') {
    return {
      logicalName: input.logicalName,
      model: input.model,
    }
  }

  const fallbackAgent = input.logicalName.split('.').pop()
  return {
    logicalName: input.logicalName,
    model: input.model,
    agent: input.agent || fallbackAgent,
  }
}

export function createConfiguredProvider(input: ProviderBindingInput, config: MagpieConfig): AIProvider {
  return createProvider(input.model, config, resolveProviderBinding(input))
}

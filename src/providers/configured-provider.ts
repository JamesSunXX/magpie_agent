import type { MagpieConfig } from '../config/types.js'
import type { AIProvider } from './types.js'
import { createProvider, getProviderForModel, getProviderForTool } from './factory.js'

export interface ProviderBindingInput {
  logicalName: string
  tool?: string
  model?: string
  agent?: string
  timeoutMs?: number
}

export interface ProviderBinding {
  logicalName: string
  tool?: string
  model?: string
  agent?: string
  timeoutMs?: number
}

export function resolveProviderBinding(input: ProviderBindingInput): ProviderBinding {
  const providerName = input.tool
    ? getProviderForTool(input.tool)
    : input.model
      ? getProviderForModel(input.model)
      : null

  if (!providerName) {
    throw new Error(`Provider binding ${input.logicalName} must include a tool or model`)
  }

  if (providerName !== 'kiro' && providerName !== 'mock' && input.agent) {
    throw new Error('Only kiro bindings may define an agent')
  }

  if (providerName !== 'kiro') {
    return {
      logicalName: input.logicalName,
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    }
  }

  const fallbackAgent = input.logicalName.split('.').pop()
  const derivedAgent = (() => {
    if (fallbackAgent === 'planner') return 'kiro_planner'
    if (fallbackAgent === 'executor') return 'dev'
    return fallbackAgent
  })()
  return {
    logicalName: input.logicalName,
    ...(input.tool ? { tool: input.tool } : {}),
    ...(input.model ? { model: input.model } : {}),
    agent: input.agent || derivedAgent,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  }
}

export function createConfiguredProvider(input: ProviderBindingInput, config: MagpieConfig): AIProvider {
  const binding = resolveProviderBinding(input)
  const selector = binding.tool
    ? getProviderForTool(binding.tool)
    : binding.model

  if (!selector) {
    throw new Error(`Provider binding ${input.logicalName} must resolve to a tool or model`)
  }

  return createProvider(selector, config, binding)
}

import type { MagpieConfig } from '../config/types.js'
import type { AIProvider } from './types.js'
import { createProvider, getProviderForModel, getProviderForTool } from './factory.js'
import { withProviderSessionPersistence } from './session-persistence.js'

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

function resolveSessionFallbackBinding(input: ProviderBinding): ProviderBinding | null {
  const fallbackBase: ProviderBinding = {
    logicalName: input.logicalName,
    tool: 'kiro',
    model: 'kiro',
    timeoutMs: input.timeoutMs,
  }

  if (input.logicalName === 'capabilities.loop.planner') {
    return { ...fallbackBase, agent: 'architect' }
  }
  if (input.logicalName === 'capabilities.loop.executor') {
    return { ...fallbackBase, agent: 'dev' }
  }
  if (input.logicalName === 'capabilities.harness.document_planner') {
    return { ...fallbackBase, agent: 'architect' }
  }
  if (/^capabilities\.harness\.validator_checks\[\d+\]$/.test(input.logicalName)) {
    return { ...fallbackBase, agent: 'architect' }
  }
  if (input.logicalName.startsWith('reviewers.')) {
    return { ...fallbackBase, agent: 'code-reviewer' }
  }
  if (input.logicalName === 'summarizer' || input.logicalName === 'analyzer') {
    return { ...fallbackBase, agent: 'architect' }
  }

  return null
}

export function createConfiguredProvider(input: ProviderBindingInput, config: MagpieConfig): AIProvider {
  const binding = resolveProviderBinding(input)
  const selector = binding.tool
    ? getProviderForTool(binding.tool)
    : binding.model

  if (!selector) {
    throw new Error(`Provider binding ${input.logicalName} must resolve to a tool or model`)
  }

  const fallbackBinding = resolveSessionFallbackBinding(binding)
  return withProviderSessionPersistence(
    createProvider(selector, config, binding),
    binding.logicalName,
    fallbackBinding
      ? {
        fallbackFactory: () => {
          const fallbackSelector = fallbackBinding.tool
            ? getProviderForTool(fallbackBinding.tool)
            : fallbackBinding.model
          if (!fallbackSelector) {
            throw new Error(`Fallback provider binding ${fallbackBinding.logicalName} must resolve to a tool or model`)
          }
          return createProvider(fallbackSelector, config, fallbackBinding)
        },
      }
      : undefined
  )
}

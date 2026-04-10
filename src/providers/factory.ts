// src/providers/factory.ts
import type { AIProvider, ProviderOptions } from './types.js'
import type { MagpieConfig } from '../config/types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import { ClaudeCodeProvider } from './claude-code.js'
import { CodexCliProvider } from './codex.js'
import { ClawProvider } from './claw.js'
import { GeminiCliProvider } from './gemini-cli.js'
import { GeminiProvider } from './gemini.js'
import { QwenCodeProvider } from './qwen-code.js'
import { KiroProvider } from './kiro.js'
import { MiniMaxProvider } from './minimax.js'
import { MockProvider } from './mock.js'

export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'claude-code'
  | 'codex'
  | 'claw'
  | 'gemini-cli'
  | 'qwen-code'
  | 'kiro'
  | 'minimax'
  | 'mock'

export type CliToolName =
  | 'claude'
  | 'claude-code'
  | 'codex'
  | 'claw'
  | 'gemini'
  | 'gemini-cli'
  | 'qwen-code'
  | 'kiro'

const CLI_TOOL_ALIASES: Record<CliToolName, Extract<ProviderName, 'claude-code' | 'codex' | 'claw' | 'gemini-cli' | 'qwen-code' | 'kiro'>> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  claw: 'claw',
  gemini: 'gemini-cli',
  'gemini-cli': 'gemini-cli',
  'qwen-code': 'qwen-code',
  kiro: 'kiro',
}

export function normalizeCliTool(tool: string): Extract<ProviderName, 'claude-code' | 'codex' | 'claw' | 'gemini-cli' | 'qwen-code' | 'kiro'> {
  const normalized = CLI_TOOL_ALIASES[tool as CliToolName]
  if (!normalized) {
    throw new Error(`Unknown tool: ${tool}`)
  }
  return normalized
}

export function getProviderForTool(tool: string): Extract<ProviderName, 'claude-code' | 'codex' | 'claw' | 'gemini-cli' | 'qwen-code' | 'kiro'> {
  return normalizeCliTool(tool)
}

export function getProviderForModel(model: string): ProviderName {
  if (model === 'claude-code') {
    return 'claude-code'
  }
  if (model === 'codex') {
    return 'codex'
  }
  if (model === 'claw') {
    return 'claw'
  }
  if (model === 'gemini-cli') {
    return 'gemini-cli'
  }
  if (model === 'qwen-code') {
    return 'qwen-code'
  }
  if (model === 'kiro') {
    return 'kiro'
  }
  if (model === 'minimax') {
    return 'minimax'
  }
  if (model.startsWith('mock')) {
    return 'mock'
  }
  if (model.startsWith('claude')) {
    return 'anthropic'
  }
  if (model.startsWith('gpt')) {
    return 'openai'
  }
  if (model.startsWith('gemini')) {
    return 'google'
  }
  throw new Error(`Unknown model: ${model}`)
}

export function createProvider(model: string, config: MagpieConfig, options?: Partial<ProviderOptions>): AIProvider {
  // Global mock mode: override all models to MockProvider
  if (config.mock) {
    return new MockProvider()
  }

  const providerName = options?.tool ? getProviderForTool(options.tool) : getProviderForModel(model)
  const selectedModel = options?.model

  // Claude Code doesn't need API key config
  if (providerName === 'claude-code') {
    return new ClaudeCodeProvider({
      apiKey: '',
      model: selectedModel,
    })
  }

  // Codex CLI doesn't need API key config
  if (providerName === 'codex') {
    return new CodexCliProvider({
      apiKey: '',
      model: selectedModel,
    })
  }

  // Claw CLI doesn't need API key config
  if (providerName === 'claw') {
    return new ClawProvider({
      apiKey: '',
      model: selectedModel,
    })
  }

  // Gemini CLI doesn't need API key config (uses Google account)
  if (providerName === 'gemini-cli') {
    return new GeminiCliProvider({
      apiKey: '',
      model: selectedModel,
    })
  }

  // Qwen Code CLI doesn't need API key config (uses OAuth)
  if (providerName === 'qwen-code') {
    return new QwenCodeProvider()
  }

  // Kiro CLI doesn't need API key config (uses AWS subscription)
  if (providerName === 'kiro') {
    return new KiroProvider({
      apiKey: '',
      model: selectedModel,
      logicalName: options?.logicalName,
      tool: options?.tool,
      agent: options?.agent,
    })
  }

  // Mock provider for debug mode — no API key needed
  if (providerName === 'mock') {
    return new MockProvider()
  }

  // MiniMax uses API key from config or env
  if (providerName === 'minimax') {
    const providerConfig = config.providers['minimax']
    return new MiniMaxProvider({
      apiKey: providerConfig?.api_key || process.env.MINIMAX_API_KEY || '',
      model: 'MiniMax-M2.5',
      baseURL: providerConfig?.base_url,
    })
  }

  const providerConfig = config.providers[providerName]

  if (!providerConfig) {
    throw new Error(`Provider ${providerName} not configured for model ${model}`)
  }

  switch (providerName) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey: providerConfig.api_key, model, baseURL: providerConfig.base_url })
    case 'openai':
      return new OpenAIProvider({ apiKey: providerConfig.api_key, model, baseURL: providerConfig.base_url })
    case 'google':
      return new GeminiProvider({ apiKey: providerConfig.api_key, model, baseURL: providerConfig.base_url })
    default:
      throw new Error(`Unknown provider: ${providerName}`)
  }
}

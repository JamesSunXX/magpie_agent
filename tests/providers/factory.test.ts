// tests/providers/factory.test.ts
import { describe, it, expect } from 'vitest'
import { createProvider, getProviderForModel, getProviderForTool, normalizeCliTool } from '../../src/providers/factory.js'
import type { MagpieConfig } from '../../src/config/types.js'
import { createConfiguredProvider } from '../../src/providers/configured-provider.js'

describe('Provider Factory', () => {
  const mockConfig: MagpieConfig = {
    providers: {
      anthropic: { api_key: 'ant-key' },
      openai: { api_key: 'oai-key' },
      'claude-code': { enabled: true },
      'codex': { enabled: true }
    },
    defaults: { max_rounds: 3, output_format: 'markdown' },
    reviewers: {},
    summarizer: { model: 'claude-sonnet-4-20250514', prompt: '' },
    analyzer: { model: 'claude-sonnet-4-20250514', prompt: '' }
  }

  describe('getProviderForModel', () => {
    it('should return anthropic for claude models', () => {
      expect(getProviderForModel('claude-sonnet-4-20250514')).toBe('anthropic')
      expect(getProviderForModel('claude-3-opus-20240229')).toBe('anthropic')
    })

    it('should return openai for gpt models', () => {
      expect(getProviderForModel('gpt-4o')).toBe('openai')
      expect(getProviderForModel('gpt-4-turbo')).toBe('openai')
    })

    it('should return google for gemini models', () => {
      expect(getProviderForModel('gemini-pro')).toBe('google')
    })

    it('should return claude-code for claude-code model', () => {
      expect(getProviderForModel('claude-code')).toBe('claude-code')
    })

    it('should return codex for codex model', () => {
      expect(getProviderForModel('codex')).toBe('codex')
    })

    it('should return claw for claw model', () => {
      expect(getProviderForModel('claw')).toBe('claw')
    })
  })

  describe('tool normalization', () => {
    it('normalizes short cli tool aliases', () => {
      expect(normalizeCliTool('claude')).toBe('claude-code')
      expect(normalizeCliTool('gemini')).toBe('gemini-cli')
    })

    it('returns provider ids for supported cli tools', () => {
      expect(getProviderForTool('claude')).toBe('claude-code')
      expect(getProviderForTool('codex')).toBe('codex')
      expect(getProviderForTool('gemini')).toBe('gemini-cli')
      expect(getProviderForTool('kiro')).toBe('kiro')
      expect(getProviderForTool('claw')).toBe('claw')
    })
  })

  describe('createProvider', () => {
    it('should create anthropic provider', () => {
      const provider = createProvider('claude-sonnet-4-20250514', mockConfig)
      expect(provider.name).toBe('anthropic')
    })

    it('should create openai provider', () => {
      const provider = createProvider('gpt-4o', mockConfig)
      expect(provider.name).toBe('openai')
    })

    it('should throw for missing provider config', () => {
      const configWithoutOpenAI = { ...mockConfig, providers: { anthropic: { api_key: 'key' } } }
      expect(() => createProvider('gpt-4o', configWithoutOpenAI)).toThrow()
    })

    it('should create claude-code provider', () => {
      const provider = createProvider('claude-code', mockConfig)
      expect(provider.name).toBe('claude-code')
    })

    it('should create gemini provider', () => {
      const configWithGoogle = {
        ...mockConfig,
        providers: { ...mockConfig.providers, google: { api_key: 'google-key' } }
      }
      const provider = createProvider('gemini-pro', configWithGoogle)
      expect(provider.name).toBe('gemini')
    })

    it('should create codex provider', () => {
      const provider = createProvider('codex', mockConfig)
      expect(provider.name).toBe('codex')
    })

    it('should create claw provider', () => {
      const provider = createProvider('claw', mockConfig)
      expect(provider.name).toBe('claw')
    })

    it('should pass base_url through to API providers', () => {
      const configWithBaseUrl: MagpieConfig = {
        ...mockConfig,
        providers: {
          anthropic: { api_key: 'ant-key', base_url: 'https://my-proxy.example.com' },
          openai: { api_key: 'oai-key', base_url: 'https://my-openai-proxy.example.com/v1' },
        }
      }
      const anthropicProvider = createProvider('claude-sonnet-4-20250514', configWithBaseUrl)
      expect(anthropicProvider.name).toBe('anthropic')

      const openaiProvider = createProvider('gpt-4o', configWithBaseUrl)
      expect(openaiProvider.name).toBe('openai')
    })

    it('should work without base_url (backwards compatible)', () => {
      const provider = createProvider('claude-sonnet-4-20250514', mockConfig)
      expect(provider.name).toBe('anthropic')
    })

    it('creates a configured kiro provider with logical binding metadata', () => {
      const provider = createConfiguredProvider({
        logicalName: 'reviewers.backend',
        model: 'kiro',
        agent: 'go-reviewer',
      }, mockConfig)

      expect(provider.name).toBe('kiro')
    })

    it('creates a configured codex provider from explicit tool plus cli model', () => {
      const provider = createConfiguredProvider({
        logicalName: 'reviewers.route-codex',
        tool: 'codex',
        model: 'gpt-5.4',
      }, mockConfig)

      expect(provider.name).toBe('codex')
    })

    it.each([
      [{ logicalName: 'reviewers.route-claude', tool: 'claude' }, 'claude-code'],
      [{ logicalName: 'reviewers.route-codex', tool: 'codex' }, 'codex'],
      [{ logicalName: 'reviewers.route-gemini', tool: 'gemini' }, 'gemini-cli'],
      [{ logicalName: 'reviewers.route-claw', tool: 'claw' }, 'claw'],
      [{ logicalName: 'reviewers.route-qwen', tool: 'qwen-code' }, 'qwen-code'],
      [{ logicalName: 'capabilities.loop.executor', tool: 'kiro', agent: 'dev' }, 'kiro'],
    ] as const)('passes timeout overrides into %s providers', (binding, expectedName) => {
      const provider = createConfiguredProvider({
        ...binding,
        timeoutMs: 12345,
      }, mockConfig)

      expect(provider.name).toBe(expectedName)
      expect((provider as { timeout?: number }).timeout).toBe(12345)
      provider.setTimeoutMs?.(54321)
      expect((provider as { timeout?: number }).timeout).toBe(54321)
    })
  })
})

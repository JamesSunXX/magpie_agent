import { describe, it, expect, vi } from 'vitest'
import { OpenAIProvider } from '../../src/providers/openai'

let lastConstructorOptions: Record<string, unknown> = {}
let lastCreatePayload: Record<string, unknown> = {}

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
          lastCreatePayload = payload
          return {
            choices: [{ message: { content: 'Mock response' } }]
          }
        })
      }
    }
    constructor(options: Record<string, unknown>) {
      lastConstructorOptions = options
    }
  }
}))

vi.mock('../../src/providers/image-utils.js', () => ({
  loadImageAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,ZmFrZS1pbWFnZQ==')
}))

describe('OpenAIProvider', () => {
  it('should have correct name', () => {
    const provider = new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o' })
    expect(provider.name).toBe('openai')
  })

  it('should call chat and return response', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o' })
    const result = await provider.chat([{ role: 'user', content: 'Hello' }])
    expect(result).toBe('Mock response')
  })

  it('should pass baseURL to SDK when provided', () => {
    new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o', baseURL: 'https://my-proxy.example.com/v1' })
    expect(lastConstructorOptions.baseURL).toBe('https://my-proxy.example.com/v1')
  })

  it('should not set baseURL when not provided', () => {
    new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o' })
    expect(lastConstructorOptions.baseURL).toBeUndefined()
  })

  it('should send image parts when images are provided', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o' })
    await provider.chat(
      [{ role: 'user', content: '请看图并分析' }],
      undefined,
      { images: [{ source: 'https://example.com/image.png' }] }
    )

    const messages = lastCreatePayload.messages as Array<{ content: unknown }>
    const content = messages[0].content as Array<{ type: string }>
    expect(Array.isArray(content)).toBe(true)
    expect(content.some(part => part.type === 'image_url')).toBe(true)
  })
})

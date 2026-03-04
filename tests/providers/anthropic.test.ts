import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '../../src/providers/anthropic.js'

let lastConstructorOptions: Record<string, unknown> = {}
let lastCreatePayload: Record<string, unknown> = {}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
        lastCreatePayload = payload
        return {
          content: [{ type: 'text', text: 'Mock response' }]
        }
      }),
      stream: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk1' } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk2' } }
        },
        abort: vi.fn()
      })
    }
    constructor(options: Record<string, unknown>) {
      lastConstructorOptions = options
    }
  }
}))

vi.mock('../../src/providers/image-utils.js', () => ({
  loadImageAsBase64: vi.fn().mockResolvedValue({
    mimeType: 'image/png',
    base64: 'ZmFrZS1pbWFnZQ==',
  }),
  toSupportedImageMimeType: vi.fn((mimeType: string) => mimeType === 'image/png' ? 'image/png' : 'image/png')
}))

describe('AnthropicProvider', () => {
  it('should have correct name', () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    expect(provider.name).toBe('anthropic')
  })

  it('should call chat and return response', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    const result = await provider.chat([{ role: 'user', content: 'Hello' }])
    expect(result).toBe('Mock response')
  })

  it('should send image blocks when images are provided', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    await provider.chat(
      [{ role: 'user', content: '请结合图片分析' }],
      undefined,
      { images: [{ source: 'https://example.com/image.png' }] }
    )

    const messages = lastCreatePayload.messages as Array<{ content: unknown }>
    const first = messages[0].content as Array<{ type: string }>
    expect(Array.isArray(first)).toBe(true)
    expect(first.some(part => part.type === 'image')).toBe(true)
  })

  it('should stream responses', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hello' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['chunk1', 'chunk2'])
  })

  it('should pass baseURL to SDK when provided', () => {
    new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514', baseURL: 'https://my-proxy.example.com' })
    expect(lastConstructorOptions.baseURL).toBe('https://my-proxy.example.com')
  })

  it('should not set baseURL when not provided', () => {
    new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' })
    expect(lastConstructorOptions.baseURL).toBeUndefined()
  })
})

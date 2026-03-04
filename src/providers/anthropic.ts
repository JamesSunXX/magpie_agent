import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { withRetry } from '../utils/retry.js'
import { loadImageAsBase64, toSupportedImageMimeType } from './image-utils.js'

export class AnthropicProvider implements AIProvider {
  name = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(options: ProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL })
    this.model = options.model
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const imageBlocks: Anthropic.ImageBlockParam[] = []

    if (options?.images && options.images.length > 0) {
      for (const image of options.images) {
        try {
          const loaded = await loadImageAsBase64(image.source)
          imageBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: toSupportedImageMimeType(loaded.mimeType),
              data: loaded.base64,
            },
          })
        } catch {
          // Best effort: ignore images that fail to load.
        }
      }
    }

    const lastUserIndex = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return i
      }
      return -1
    })()

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, idx) => {
      const role: Anthropic.MessageParam['role'] = m.role === 'assistant' ? 'assistant' : 'user'
      const shouldAttachImages = idx === lastUserIndex && m.role === 'user' && imageBlocks.length > 0
      if (!shouldAttachImages) {
        return {
          role,
          content: m.content,
        }
      }
      return {
        role,
        content: [
          { type: 'text', text: m.content },
          ...imageBlocks,
        ],
      }
    })

    const response = await withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        stream: false,
        messages: anthropicMessages,
      })
    )

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )
    return textBlock?.type === 'text' ? textBlock.text : ''
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content
      }))
    })

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }
    } finally {
      stream.abort()
    }
  }
}

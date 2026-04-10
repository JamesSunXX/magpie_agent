import OpenAI from 'openai'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { withRetry } from '../utils/retry.js'
import { loadImageAsDataUrl } from './image-utils.js'

export class OpenAIProvider implements AIProvider {
  name = 'openai'
  private client: OpenAI
  private model: string

  constructor(options: ProviderOptions) {
    if (!options.model) {
      throw new Error('OpenAI provider requires a model')
    }
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL })
    this.model = options.model
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []

    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt })
    }

    const imageParts: OpenAI.Chat.ChatCompletionContentPartImage[] = []
    if (options?.images && options.images.length > 0) {
      for (const image of options.images) {
        try {
          const dataUrl = await loadImageAsDataUrl(image.source)
          imageParts.push({
            type: 'image_url',
            image_url: { url: dataUrl },
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

    for (const [idx, m] of messages.entries()) {
      if (m.role === 'system') {
        msgs.push({
          role: 'system',
          content: m.content,
        })
        continue
      }

      if (m.role === 'assistant') {
        msgs.push({
          role: 'assistant',
          content: m.content,
        })
        continue
      }

      const shouldAttachImages = idx === lastUserIndex && imageParts.length > 0
      if (!shouldAttachImages) {
        msgs.push({
          role: 'user',
          content: m.content,
        })
        continue
      }

      const content: OpenAI.Chat.ChatCompletionUserMessageParam['content'] = [
        { type: 'text', text: m.content },
        ...imageParts,
      ]
      msgs.push({
        role: 'user',
        content,
      })
    }

    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: msgs
      })
    )

    return response.choices[0]?.message?.content || ''
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []

    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt })
    }

    msgs.push(...messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    })))

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: msgs,
      stream: true
    })

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          yield content
        }
      }
    } finally {
      stream.controller.abort()
    }
  }
}

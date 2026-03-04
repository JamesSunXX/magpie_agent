import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { withRetry } from '../utils/retry.js'
import { loadImageAsBase64 } from './image-utils.js'

export class GeminiProvider implements AIProvider {
  name = 'gemini'
  private client: GoogleGenerativeAI
  private model: string
  private requestOptions?: { baseUrl: string }

  constructor(options: ProviderOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey)
    this.model = options.model
    if (options.baseURL) {
      this.requestOptions = { baseUrl: options.baseURL }
    }
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt ? { role: 'user', parts: [{ text: systemPrompt }] } : undefined
    }, this.requestOptions)

    const inlineImageParts: Array<{ inlineData: { mimeType: string; data: string } }> = []
    if (options?.images && options.images.length > 0) {
      for (const image of options.images) {
        try {
          const loaded = await loadImageAsBase64(image.source)
          inlineImageParts.push({
            inlineData: {
              mimeType: loaded.mimeType,
              data: loaded.base64,
            },
          })
        } catch {
          // Best effort: ignore images that fail to load.
        }
      }
    }

    // Build conversation history
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const chat = model.startChat({ history })

    const lastMessage = messages[messages.length - 1]
    const lastParts = inlineImageParts.length > 0
      ? [{ text: lastMessage.content }, ...inlineImageParts]
      : lastMessage.content
    const result = await withRetry(() => chat.sendMessage(lastParts))
    return result.response.text()
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt ? { role: 'user', parts: [{ text: systemPrompt }] } : undefined
    }, this.requestOptions)

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const chat = model.startChat({ history })

    const lastMessage = messages[messages.length - 1]
    const result = await chat.sendMessageStream(lastMessage.content)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield text
      }
    }
    // Gemini SDK doesn't expose stream.close(); consuming all chunks is sufficient cleanup
  }
}

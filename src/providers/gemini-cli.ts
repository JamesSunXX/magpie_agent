import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class GeminiCliProvider implements AIProvider {
  name = 'gemini-cli'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private session = new CliSessionHelper()
  // Gemini gets its session ID from the first response (session_id in JSON)
  private sessionEnabled = false

  get sessionId() { return this.session.sessionId }

  constructor(_options?: ProviderOptions) {
    // No API key needed for Gemini CLI (uses Google account)
    this.cwd = process.cwd()
    this.timeout = 15 * 60 * 1000  // 15 minutes default
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  startSession(name?: string): void {
    this.sessionEnabled = true
    this.session.start(name)
    this.session.sessionId = undefined  // Will be set from first response's JSON
  }

  endSession(): void {
    this.sessionEnabled = false
    this.session.end()
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    const result = await this.runGemini(this.attachImageRefs(prompt, options))
    this.session.markMessageSent()
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    yield* this.runGeminiStream(prompt)
    this.session.markMessageSent()
  }

  private attachImageRefs(prompt: string, options?: ChatOptions): string {
    if (!options?.images || options.images.length === 0) return prompt

    const refs = options.images
      .map(image => `@{${image.source}}`)
      .join('\n')

    return `${prompt}\n\n请结合以下图片引用进行分析：\n${refs}`
  }

  private runGemini(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Always use stream-json so session resume works (sessions created in
      // stream-json mode cannot be resumed with -o json).
      const args = ['-y', '-o', 'stream-json', '-p', '-']
      if (this.sessionEnabled && this.sessionId) {
        args.push('--resume', this.sessionId)
      }

      const child = spawn('gemini', args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      child.stdin.write(prompt)
      child.stdin.end()

      let output = ''
      let error = ''

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        error += data.toString()
      })

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Gemini CLI exited with code ${code}: ${error}`))
        } else {
          // Parse NDJSON lines and collect assistant messages
          let result = ''
          for (const line of output.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const event = JSON.parse(trimmed)
              if (event.type === 'init' && event.session_id && this.sessionEnabled) {
                this.session.sessionId = event.session_id
              } else if (event.type === 'message' && event.role === 'assistant' && event.content) {
                result += event.content
              }
            } catch {
              // ignore non-JSON lines
            }
          }
          resolve(result)
        }
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to run gemini CLI: ${err.message}`))
      })
    })
  }

  private async *runGeminiStream(prompt: string): AsyncGenerator<string, void, unknown> {
    const args = ['-y', '-o', 'stream-json', '-p', '-']
    if (this.sessionEnabled && this.sessionId) {
      args.push('--resume', this.sessionId)
    }

    const child = spawn('gemini', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    child.stdin.write(prompt)
    child.stdin.end()

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let stderrBuf = ''
    let lastActivity = Date.now()
    let lineBuf = ''  // Buffer for NDJSON line parsing

    // Timeout checker - kill if no activity for too long
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout) {
        child.kill('SIGTERM')
        done = true
        error = new Error(`Gemini CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, 10000) : null  // Check every 10s

    const pushChunk = (chunk: string) => {
      if (resolveNext) {
        resolveNext({ chunk })
        resolveNext = null
      } else {
        chunks.push(chunk)
      }
    }

    child.stdout.on('data', (data) => {
      lastActivity = Date.now()
      lineBuf += data.toString()

      // Parse complete NDJSON lines
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''  // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed)
          if (event.type === 'init' && event.session_id && this.sessionEnabled) {
            this.session.sessionId = event.session_id
          } else if (event.type === 'message' && event.role === 'assistant' && event.content) {
            pushChunk(event.content)
          }
        } catch {
          // Not valid JSON, ignore
        }
      }
    })

    child.stderr.on('data', (data) => {
      lastActivity = Date.now()
      stderrBuf += data.toString()
    })

    child.on('close', (code) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      // Process any remaining data in line buffer
      if (lineBuf.trim()) {
        try {
          const event = JSON.parse(lineBuf.trim())
          if (event.type === 'init' && event.session_id && this.sessionEnabled) {
            this.session.sessionId = event.session_id
          } else if (event.type === 'message' && event.role === 'assistant' && event.content) {
            pushChunk(event.content)
          }
        } catch {
          // ignore
        }
      }
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Gemini CLI exited with code ${code}${stderrBuf ? ': ' + stderrBuf.slice(0, 500) : ''}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run gemini CLI: ${err.message}`)
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!
      } else if (!done) {
        const result = await new Promise<{ chunk: string | null }>((resolve) => {
          resolveNext = resolve
        })
        if (result.chunk !== null) {
          yield result.chunk
        }
      }
    }

    if (error) {
      throw error
    }
  }
}

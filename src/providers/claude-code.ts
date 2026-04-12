import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class ClaudeCodeProvider implements AIProvider {
  name = 'claude-code'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private readonly model?: string
  private session = new CliSessionHelper()

  get sessionId() { return this.session.sessionId }

  constructor(_options?: ProviderOptions) {
    // No API key needed for Claude Code CLI
    // Use current working directory so claude can access the repo
    this.cwd = process.cwd()
    if (Number.isFinite(_options?.timeoutMs) && (_options?.timeoutMs ?? -1) >= 0) {
      this.timeout = Math.floor(_options!.timeoutMs!)
    } else {
      const envTimeout = process.env.MAGPIE_CLAUDE_TIMEOUT_MS
      const parsedTimeout = envTimeout ? Number(envTimeout) : Number.NaN
      if (Number.isFinite(parsedTimeout) && parsedTimeout >= 0) {
        this.timeout = Math.floor(parsedTimeout)
      } else {
        this.timeout = 15 * 60 * 1000  // 15 minutes default
      }
    }
    this.model = _options?.model
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  setTimeoutMs(timeoutMs: number) {
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      this.timeout = Math.floor(timeoutMs)
    }
  }

  startSession(name?: string): void {
    this.session.start(name)
  }

  endSession(): void {
    this.session.end()
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.session.shouldSendFullHistory()
      ? this.session.buildPrompt(messages, systemPrompt)
      : this.session.buildPromptLastOnly(messages)
    const result = await this.runClaude(this.attachImagePaths(prompt, options), systemPrompt, options)
    this.session.markMessageSent()
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.session.shouldSendFullHistory()
      ? this.session.buildPrompt(messages, systemPrompt)
      : this.session.buildPromptLastOnly(messages)
    yield* this.runClaudeStream(prompt, systemPrompt)
    this.session.markMessageSent()
  }

  private attachImagePaths(prompt: string, options?: ChatOptions): string {
    if (!options?.images || options.images.length === 0) return prompt

    const lines = options.images.map((image, idx) => {
      const label = image.label || `Image ${idx + 1}`
      return `- ${label}: ${image.source}`
    })

    return `${prompt}\n\n请直接读取并分析以下图片路径/URL：\n${lines.join('\n')}`
  }

  private getModelArgs(): string[] {
    if (!this.model || this.model === 'claude-code') {
      return []
    }
    return ['--model', this.model]
  }

  private getTimeoutCheckInterval(): number {
    if (this.timeout <= 0) return 0
    return Math.min(10000, Math.max(200, Math.floor(this.timeout / 5)))
  }

  private runClaude(prompt: string, systemPrompt?: string, options?: ChatOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build args based on session state
      // Use --dangerously-skip-permissions to allow network access (e.g., gh commands)
      const args = ['-p', '-', '--dangerously-skip-permissions']
      args.push(...this.getModelArgs())
      // Disable all tools for pure text extraction (e.g., JSON structurization)
      // Without this, Claude may use Edit/Write to modify files instead of outputting text
      if (options?.disableTools) {
        args.push('--tools', '')
      }
      if (this.session.sessionId) {
        if (this.session.isFirstMessage) {
          args.push('--session-id', this.session.sessionId)
          if (systemPrompt) {
            args.push('--system-prompt', systemPrompt)
          }
        } else {
          args.push('--resume', this.session.sessionId)
        }
      }

      const child = spawn('claude', args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let error = ''
      let settled = false
      let lastActivity = Date.now()
      const checkInterval = this.getTimeoutCheckInterval()
      const timeoutChecker = this.timeout > 0 ? setInterval(() => {
        if (Date.now() - lastActivity > this.timeout && !settled) {
          if (timeoutChecker) clearInterval(timeoutChecker)
          child.kill('SIGTERM')
          settled = true
          reject(new Error(`Claude CLI timed out after ${this.timeout / 1000}s of inactivity`))
        }
      }, checkInterval) : null

      child.stdout.on('data', (data) => {
        lastActivity = Date.now()
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        lastActivity = Date.now()
        error += data.toString()
      })

      child.on('close', (code) => {
        if (timeoutChecker) clearInterval(timeoutChecker)
        if (settled) return
        settled = true
        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${error}`))
        } else {
          resolve(output.trim())
        }
      })

      child.on('error', (err) => {
        if (timeoutChecker) clearInterval(timeoutChecker)
        if (settled) return
        settled = true
        reject(new Error(`Failed to run claude CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      child.stdin.write(prompt)
      child.stdin.end()
    })
  }

  private async *runClaudeStream(prompt: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    // Build args based on session state
    // Use --dangerously-skip-permissions to allow network access (e.g., gh commands)
    const args = ['-p', '-', '--dangerously-skip-permissions']
    args.push(...this.getModelArgs())
    if (this.session.sessionId) {
      if (this.session.isFirstMessage) {
        args.push('--session-id', this.session.sessionId)
        if (systemPrompt) {
          args.push('--system-prompt', systemPrompt)
        }
      } else {
        args.push('--resume', this.session.sessionId)
      }
    }

    const child = spawn('claude', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let lastActivity = Date.now()

    // Timeout checker - kill if no activity for too long
    const checkInterval = this.getTimeoutCheckInterval()
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout) {
        child.kill('SIGTERM')
        done = true
        error = new Error(`Claude CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, checkInterval) : null

    child.stdout.on('data', (data) => {
      lastActivity = Date.now()
      const chunk = data.toString()
      if (resolveNext) {
        resolveNext({ chunk })
        resolveNext = null
      } else {
        chunks.push(chunk)
      }
    })

    child.stderr.on('data', (_data) => {
      lastActivity = Date.now()  // Activity on stderr also counts
    })

    child.on('close', (code) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Claude CLI exited with code ${code}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run claude CLI: ${err.message}`)
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    // Write prompt to stdin and close
    child.stdin.write(prompt)
    child.stdin.end()

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

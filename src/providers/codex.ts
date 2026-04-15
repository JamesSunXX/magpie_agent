import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions, ChatOptions, ProviderProgressEvent } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class CodexCliProvider implements AIProvider {
  name = 'codex'
  private static readonly TURN_COMPLETION_GRACE_MS = 5000
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private readonly model?: string
  private session = new CliSessionHelper()
  // Codex gets its session ID from the first response (thread_id in JSONL)
  private sessionEnabled = false

  get sessionId() { return this.session.sessionId }

  constructor(_options?: ProviderOptions) {
    // No API key needed for Codex CLI (uses subscription)
    this.cwd = process.cwd()
    if (Number.isFinite(_options?.timeoutMs) && (_options?.timeoutMs ?? -1) >= 0) {
      this.timeout = Math.floor(_options!.timeoutMs!)
    } else {
      const envTimeout = process.env.MAGPIE_CODEX_TIMEOUT_MS
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
    this.sessionEnabled = true
    this.session.start(name)
    this.session.sessionId = undefined  // Will be set from first response's JSONL
  }

  endSession(): void {
    this.sessionEnabled = false
    this.session.end()
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    const { prompt: finalPrompt, codexImageFiles } = this.preparePromptAndImages(prompt, options)
    const result = await this.runCodex(finalPrompt, codexImageFiles, options?.onProgress)
    this.session.markMessageSent()
    return result
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.sessionEnabled && !this.session.shouldSendFullHistory()
      ? this.session.buildPromptLastOnly(messages)
      : this.session.buildPrompt(messages, systemPrompt)
    yield* this.runCodexStream(prompt)
    this.session.markMessageSent()
  }

  private getModelArgs(): string[] {
    if (!this.model || this.model === 'codex') {
      return []
    }
    return ['-m', this.model]
  }

  private buildArgs(imageFiles: string[]): string[] {
    const baseArgs = ['--json', '--dangerously-bypass-approvals-and-sandbox']
    for (const file of imageFiles) {
      baseArgs.push('--image', file)
    }
    if (this.sessionEnabled && this.sessionId) {
      // Resume existing session
      return ['exec', 'resume', this.sessionId, ...this.getModelArgs(), ...baseArgs, '-']
    }
    // New session or no session
    return ['exec', ...this.getModelArgs(), ...baseArgs, '-']
  }

  private preparePromptAndImages(
    prompt: string,
    options?: ChatOptions
  ): { prompt: string; codexImageFiles: string[] } {
    if (!options?.images || options.images.length === 0) {
      return { prompt, codexImageFiles: [] }
    }

    const codexImageFiles: string[] = []
    const remoteRefs: string[] = []
    for (const image of options.images) {
      if (/^https?:\/\//i.test(image.source)) {
        remoteRefs.push(image.source)
      } else {
        codexImageFiles.push(image.source)
      }
    }

    if (remoteRefs.length === 0) {
      return { prompt, codexImageFiles }
    }

    const fallback = remoteRefs.map((src, idx) => `- RemoteImage${idx + 1}: ${src}`).join('\n')
    return {
      prompt: `${prompt}\n\nAdditional remote image references (analyze if accessible):\n${fallback}`,
      codexImageFiles,
    }
  }

  // Parse JSONL output: extract thread_id and agent_message text
  private parseJsonlOutput(output: string): string {
    let text = ''
    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed)
        if (event.type === 'thread.started' && event.thread_id && this.sessionEnabled) {
          this.session.sessionId = event.thread_id
        } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
          text += event.item.text
        }
      } catch {
        // Not valid JSON, ignore
      }
    }
    return text
  }

  private handleProgressEvent(event: Record<string, unknown>, onProgress?: (event: ProviderProgressEvent) => void): void {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string' && this.sessionEnabled) {
      this.session.sessionId = event.thread_id
    }

    if (!onProgress || typeof event.type !== 'string') {
      return
    }

    const type = event.type
    if (type === 'item.completed' && event.item && typeof event.item === 'object' && (event.item as { type?: string }).type === 'agent_message') {
      return
    }

    let summary: string | undefined
    let details: Record<string, unknown> | undefined
    const item = event.item && typeof event.item === 'object'
      ? event.item as Record<string, unknown>
      : undefined
    const itemType = typeof item?.type === 'string' ? item.type : undefined

    if (type === 'thread.started') {
      summary = 'Codex session started.'
    } else if (type === 'turn.started') {
      summary = 'Codex turn started.'
    } else if (type === 'turn.completed') {
      summary = 'Codex turn completed.'
    } else if (type === 'error' && typeof event.message === 'string') {
      summary = event.message
    } else if (type === 'item.started' && itemType) {
      summary = `${itemType} started.`
      details = { itemType }
    } else if (type === 'item.completed' && itemType) {
      summary = `${itemType} completed.`
      details = { itemType }
    } else {
      summary = type
    }

    onProgress({
      provider: this.name,
      kind: type,
      ...(summary ? { summary } : {}),
      ...(details ? { details } : {}),
    })
  }

  private flushJsonLines(
    lineBuf: string,
    onProgress?: (event: ProviderProgressEvent) => void
  ): { remainder: string; sawTurnCompleted: boolean } {
    const lines = lineBuf.split('\n')
    const remainder = lines.pop() || ''
    let sawTurnCompleted = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>
        this.handleProgressEvent(event, onProgress)
        if (event.type === 'turn.completed') {
          sawTurnCompleted = true
        }
      } catch {
        // Ignore non-JSON output from the CLI.
      }
    }

    return { remainder, sawTurnCompleted }
  }

  private runCodex(
    prompt: string,
    imageFiles: string[],
    onProgress?: (event: ProviderProgressEvent) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(imageFiles)
      const child = spawn('codex', args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let error = ''
      let settled = false
      const startTime = Date.now()
      let lastActivity = Date.now()
      let lineBuf = ''
      let sawTurnCompleted = false
      let completionGraceTimer: NodeJS.Timeout | null = null
      const checkInterval = this.getTimeoutCheckInterval()
      const graceMs = this.timeout > 0
        ? Math.min(this.timeout, CodexCliProvider.TURN_COMPLETION_GRACE_MS)
        : CodexCliProvider.TURN_COMPLETION_GRACE_MS
      const clearCompletionGraceTimer = () => {
        if (completionGraceTimer) {
          clearTimeout(completionGraceTimer)
          completionGraceTimer = null
        }
      }
      const resolveWithCurrentOutput = () => {
        if (settled) return
        settled = true
        clearCompletionGraceTimer()
        if (timeoutChecker) clearInterval(timeoutChecker)
        child.kill('SIGTERM')
        resolve(this.parseJsonlOutput(output))
      }
      const armCompletionGraceTimer = () => {
        if (completionGraceTimer || settled) return
        completionGraceTimer = setTimeout(() => {
          resolveWithCurrentOutput()
        }, graceMs)
      }
      const timeoutChecker = this.timeout > 0 ? setInterval(() => {
        const elapsed = Date.now() - startTime
        const idle = Date.now() - lastActivity
        if ((elapsed > this.timeout || idle > this.timeout) && !settled) {
          clearCompletionGraceTimer()
          if (timeoutChecker) clearInterval(timeoutChecker)
          child.kill('SIGTERM')
          settled = true
          reject(new Error(`Codex CLI timed out after ${this.timeout / 1000}s`))
        }
      }, checkInterval) : null

      child.stdout.on('data', (data) => {
        lastActivity = Date.now()
        const chunk = data.toString()
        output += chunk
        lineBuf += chunk
        const flushed = this.flushJsonLines(lineBuf, onProgress)
        lineBuf = flushed.remainder
        if (flushed.sawTurnCompleted) {
          sawTurnCompleted = true
          armCompletionGraceTimer()
        }
      })

      child.stderr.on('data', (data) => {
        lastActivity = Date.now()
        error += data.toString()
      })

      child.on('close', (code) => {
        clearCompletionGraceTimer()
        if (timeoutChecker) clearInterval(timeoutChecker)
        if (settled) return
        settled = true
        if (lineBuf.trim()) {
          try {
            const event = JSON.parse(lineBuf.trim()) as Record<string, unknown>
            this.handleProgressEvent(event, onProgress)
            if (event.type === 'turn.completed') {
              sawTurnCompleted = true
            }
          } catch {
            // Ignore trailing non-JSON output.
          }
        }
        if (code !== 0 && !sawTurnCompleted) {
          reject(new Error(`Codex CLI exited with code ${code}: ${error}`))
        } else {
          resolve(this.parseJsonlOutput(output))
        }
      })

      child.on('error', (err) => {
        clearCompletionGraceTimer()
        if (timeoutChecker) clearInterval(timeoutChecker)
        if (settled) return
        settled = true
        reject(new Error(`Failed to run codex CLI: ${err.message}`))
      })

      // Write prompt to stdin and close
      child.stdin.write(prompt)
      child.stdin.end()
    })
  }

  private getTimeoutCheckInterval(): number {
    if (this.timeout <= 0) return 0
    return Math.min(10000, Math.max(200, Math.floor(this.timeout / 5)))
  }

  private async *runCodexStream(prompt: string): AsyncGenerator<string, void, unknown> {
    const args = this.buildArgs([])
    const child = spawn('codex', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let lastActivity = Date.now()
    let stderrOutput = ''
    let lineBuf = ''  // Buffer for JSONL line parsing
    const checkInterval = this.getTimeoutCheckInterval()

    // Timeout checker - kill if no activity for too long
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout && !done) {
        if (timeoutChecker) clearInterval(timeoutChecker)
        child.kill('SIGTERM')
        done = true
        error = new Error(`Codex CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, checkInterval) : null

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

      // Parse complete JSONL lines
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''  // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>
          this.handleProgressEvent(event)
          if (event.type === 'item.completed'
            && event.item
            && typeof event.item === 'object'
            && (event.item as { type?: string }).type === 'agent_message'
            && typeof (event.item as { text?: string }).text === 'string') {
            pushChunk((event.item as { text: string }).text)
          }
        } catch {
          // Not valid JSON, ignore
        }
      }
    })

    child.stderr.on('data', (data) => {
      lastActivity = Date.now()  // Activity on stderr also counts
      stderrOutput += data.toString()
    })

    child.on('close', (code) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      // Process any remaining data in line buffer
      if (lineBuf.trim()) {
        try {
          const event = JSON.parse(lineBuf.trim()) as Record<string, unknown>
          this.handleProgressEvent(event)
          if (event.type === 'item.completed'
            && event.item
            && typeof event.item === 'object'
            && (event.item as { type?: string }).type === 'agent_message'
            && typeof (event.item as { text?: string }).text === 'string') {
            pushChunk((event.item as { text: string }).text)
          }
        } catch {
          // ignore
        }
      }
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Codex CLI exited with code ${code}${stderrOutput ? ': ' + stderrOutput : ''}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run codex CLI: ${err.message}`)
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

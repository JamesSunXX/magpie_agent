import { spawn } from 'child_process'
import { homedir } from 'os'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class ClawProvider implements AIProvider {
  name = 'claw'
  private cwd: string
  private timeout: number  // ms, 0 = no timeout
  private readonly model: string
  private promptHelper = new CliSessionHelper()

  constructor(options?: ProviderOptions) {
    this.cwd = process.cwd()
    if (Number.isFinite(options?.timeoutMs) && (options?.timeoutMs ?? -1) >= 0) {
      this.timeout = Math.floor(options!.timeoutMs!)
    } else {
      this.timeout = 15 * 60 * 1000  // 15 minutes default
    }
    this.model = options?.model || process.env.CLAW_MODEL || process.env.ANTHROPIC_MODEL || 'openai/gemma-4-26b-a4b'
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  setTimeoutMs(timeoutMs: number) {
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      this.timeout = Math.floor(timeoutMs)
    }
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.attachImageRefs(
      this.promptHelper.buildPrompt(messages, systemPrompt),
      options
    )
    return this.runClaw(prompt, options)
  }

  async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const prompt = this.promptHelper.buildPrompt(messages, systemPrompt)
    yield* this.runClawStream(prompt)
  }

  private attachImageRefs(prompt: string, options?: ChatOptions): string {
    if (!options?.images || options.images.length === 0) return prompt

    const refs = options.images
      .map((image, idx) => {
        const label = image.label || `Image ${idx + 1}`
        return `- ${label}: ${image.source}\n  ref: @{${image.source}}`
      })
      .join('\n')

    return `${prompt}\n\n请结合以下图片引用进行分析：\n${refs}`
  }

  private parseJsonMessage(output: string): string {
    const trimmed = output.trim()
    if (!trimmed) {
      return ''
    }

    const parsed = JSON.parse(trimmed) as { message?: unknown }
    return typeof parsed.message === 'string'
      ? parsed.message.trim()
      : ''
  }

  private runClaw(prompt: string, options?: ChatOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputFormat = options?.outputFormat === 'text' ? 'text' : 'json'
      const args = ['--model', this.model, ...(outputFormat === 'json' ? ['--output-format', 'json'] : []), '-p', '-']
      const child = spawn('claw', args, {
        cwd: this.cwd,
        env: this.buildEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let error = ''
      let settled = false
      let lastActivity = Date.now()
      const timeoutChecker = this.timeout > 0 ? setInterval(() => {
        if (Date.now() - lastActivity > this.timeout && !settled) {
          if (timeoutChecker) clearInterval(timeoutChecker)
          child.kill('SIGTERM')
          settled = true
          reject(new Error(`Claw CLI timed out after ${this.timeout / 1000}s of inactivity`))
        }
      }, 10000) : null

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
          reject(new Error(`Claw CLI exited with code ${code}: ${error}`))
          return
        }
        if (outputFormat === 'json') {
          try {
            resolve(this.parseJsonMessage(output))
          } catch (parseError) {
            reject(new Error(`Failed to parse claw JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}`))
          }
          return
        }

        resolve(output.trim())
      })

      child.on('error', (err) => {
        if (timeoutChecker) clearInterval(timeoutChecker)
        if (settled) return
        settled = true
        reject(new Error(`Failed to run claw CLI: ${err.message}`))
      })

      child.stdin.write(prompt)
      child.stdin.end()
    })
  }

  private async *runClawStream(prompt: string): AsyncGenerator<string, void, unknown> {
    const child = spawn('claw', ['--model', this.model, '-p', '-'], {
      cwd: this.cwd,
      env: this.buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const chunks: string[] = []
    let resolveNext: ((value: { chunk: string | null }) => void) | null = null
    let done = false
    let error: Error | null = null
    let stderrOutput = ''
    let lastActivity = Date.now()
    const timeoutChecker = this.timeout > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > this.timeout) {
        if (timeoutChecker) clearInterval(timeoutChecker)
        child.kill('SIGTERM')
        done = true
        error = new Error(`Claw CLI timed out after ${this.timeout / 1000}s of inactivity`)
        if (resolveNext) {
          resolveNext({ chunk: null })
        }
      }
    }, 10000) : null

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

    child.stderr.on('data', (data) => {
      lastActivity = Date.now()
      stderrOutput += data.toString()
    })

    child.on('close', (code) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Claw CLI exited with code ${code}${stderrOutput ? `: ${stderrOutput}` : ''}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
      if (timeoutChecker) clearInterval(timeoutChecker)
      done = true
      error = new Error(`Failed to run claw CLI: ${err.message}`)
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

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

  private buildEnv(): NodeJS.ProcessEnv {
    const homeBin = `${homedir()}/bin`
    const path = process.env.PATH || ''
    const pathWithHomeBin = path.includes(homeBin)
      ? path
      : `${homeBin}:${path}`

    return {
      ...process.env,
      PATH: pathWithHomeBin,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'lm-studio',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'http://localhost:1234/v1',
    }
  }
}

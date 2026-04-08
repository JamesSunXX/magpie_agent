import { spawn } from 'child_process'
import { homedir } from 'os'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class ClawProvider implements AIProvider {
  name = 'claw'
  private cwd: string
  private readonly model: string
  private promptHelper = new CliSessionHelper()

  constructor(_options?: ProviderOptions) {
    this.cwd = process.cwd()
    this.model = process.env.CLAW_MODEL || process.env.ANTHROPIC_MODEL || 'openai/gemma-4-26b-a4b'
  }

  setCwd(cwd: string) {
    this.cwd = cwd
  }

  async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
    const prompt = this.attachImageRefs(
      this.promptHelper.buildPrompt(messages, systemPrompt),
      options
    )
    return this.runClaw(prompt)
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

  private runClaw(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('claw', ['--model', this.model, '-p', '-'], {
        cwd: this.cwd,
        env: this.buildEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

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
          reject(new Error(`Claw CLI exited with code ${code}: ${error}`))
          return
        }
        resolve(output.trim())
      })

      child.on('error', (err) => {
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

    child.stdout.on('data', (data) => {
      const chunk = data.toString()
      if (resolveNext) {
        resolveNext({ chunk })
        resolveNext = null
      } else {
        chunks.push(chunk)
      }
    })

    child.stderr.on('data', (data) => {
      stderrOutput += data.toString()
    })

    child.on('close', (code) => {
      done = true
      if (code !== 0 && !error) {
        error = new Error(`Claw CLI exited with code ${code}${stderrOutput ? `: ${stderrOutput}` : ''}`)
      }
      if (resolveNext) {
        resolveNext({ chunk: null })
      }
    })

    child.on('error', (err) => {
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

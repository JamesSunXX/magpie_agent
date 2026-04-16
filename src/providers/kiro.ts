import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'
import { ensureKiroInstall, resolveInstalledKiroAgent } from './kiro-install.js'
import { withRetry } from '../utils/retry.js'

const KIRO_RETRY_BACKOFF_MS = [1000, 2000]

export class KiroProvider implements AIProvider {
    name = 'kiro'
    private cwd: string
    private timeout: number  // ms, 0 = no timeout
    private readonly logicalName?: string
    private readonly model?: string
    private readonly desiredAgent?: string
    private session = new CliSessionHelper()

    get sessionId() { return this.session.sessionId }

    constructor(options?: ProviderOptions) {
        // No API key needed for Kiro CLI (uses AWS subscription)
        this.cwd = process.cwd()
        this.logicalName = options?.logicalName
        this.model = options?.model
        this.desiredAgent = options?.agent
        if (Number.isFinite(options?.timeoutMs) && (options?.timeoutMs ?? -1) >= 0) {
            this.timeout = Math.floor(options!.timeoutMs!)
        } else {
            const envTimeout = process.env.MAGPIE_KIRO_TIMEOUT_MS
            const parsedTimeout = envTimeout ? Number(envTimeout) : Number.NaN
            if (Number.isFinite(parsedTimeout) && parsedTimeout >= 0) {
                this.timeout = Math.floor(parsedTimeout)
            } else {
                this.timeout = 15 * 60 * 1000  // 15 minutes default
            }
        }
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

    restoreSession(sessionId: string, name?: string): void {
        this.session.restore(sessionId, name)
    }

    endSession(): void {
        this.session.end()
    }

    async resolveAgent(): Promise<string> {
        const sourceDir = join(this.cwd, 'agents', 'kiro-config')
        const installScript = join(sourceDir, 'install.sh')
        if (!existsSync(sourceDir) || !existsSync(installScript)) {
            return resolveInstalledKiroAgent({
                cwd: this.cwd,
                desiredAgent: this.desiredAgent,
            })
        }

        return ensureKiroInstall({
            sourceDir,
            desiredAgent: this.desiredAgent
        }).selectedAgent
    }

    async chat(messages: Message[], systemPrompt?: string, options?: ChatOptions): Promise<string> {
        const prompt = this.session.shouldSendFullHistory()
            ? this.session.buildPrompt(messages, systemPrompt)
            : this.session.buildPromptLastOnly(messages)
        const result = await this.retryKiro(() => this.runKiro(this.attachImageRefs(prompt, options)))
        this.session.markMessageSent()
        return result
    }

    async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
        const prompt = this.session.shouldSendFullHistory()
            ? this.session.buildPrompt(messages, systemPrompt)
            : this.session.buildPromptLastOnly(messages)
        yield* this.runKiroStreamWithRetry(prompt)
        this.session.markMessageSent()
    }

    private attachImageRefs(prompt: string, options?: ChatOptions): string {
        if (!options?.images || options.images.length === 0) return prompt

        const refs = options.images
            .map(image => `@{${image.source}}`)
            .join('\n')
        const list = options.images
            .map((image, idx) => `- ${image.label || `Image ${idx + 1}`}: ${image.source}`)
            .join('\n')

        return `${prompt}\n\n请结合以下图片进行分析（图片引用）：\n${refs}\n\n图片路径清单：\n${list}`
    }

    private getModelArgs(): string[] {
        if (!this.model || this.model === 'kiro') {
            return []
        }
        return ['--model', this.model]
    }

    private getTimeoutCheckInterval(): number {
        if (this.timeout <= 0) return 0
        // Keep timeout checks responsive while avoiding tight polling loops.
        return Math.min(10000, Math.max(200, Math.floor(this.timeout / 5)))
    }

    private buildKiroArgs(agent: string): string[] {
        const args = ['chat', '--no-interactive', '--trust-all-tools']
        args.push(...this.getModelArgs())
        args.push('--agent', agent)
        if (this.session.sessionId && !this.session.isFirstMessage) {
            args.push('--resume')
        }
        return args
    }

    private async retryKiro<T>(fn: () => Promise<T>): Promise<T> {
        return withRetry(fn, {
            backoffMs: KIRO_RETRY_BACKOFF_MS,
            shouldRetry: (error) => this.isRetryableKiroError(error),
        })
    }

    private isRetryableKiroError(error: unknown): boolean {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
        return message.includes('dispatch failure')
            || message.includes('failed to send the request')
            || message.includes('error sending request for url')
            || message.includes('having trouble responding right now')
            || message.includes('timeout')
    }

    private formatCliExitError(code: number | null, stderr: string): Error {
        const cleanError = this.stripAnsiCodes(stderr).trim()
        if (!cleanError) {
            return new Error(`kiro-cli exited with code ${code}`)
        }
        return new Error(`kiro-cli exited with code ${code}: ${cleanError}`)
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms))
    }

    private async runKiro(prompt: string): Promise<string> {
        const agent = await this.resolveAgent()

        return new Promise((resolve, reject) => {
            // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
            const args = ['chat', '--no-interactive', '--trust-all-tools']
            args.push(...this.getModelArgs())
            args.push('--agent', agent)
            if (this.session.sessionId && !this.session.isFirstMessage) {
                args.push('--resume')
            }
            // Pass prompt via stdin to avoid E2BIG when prompt is large

            const child = spawn('kiro-cli', args, {
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
                    reject(new Error(`kiro-cli timed out after ${this.timeout / 1000}s of inactivity`))
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
                    reject(this.formatCliExitError(code, error))
                } else {
                    resolve(this.stripAnsiCodes(output).trim())
                }
            })

            child.on('error', (err) => {
                if (timeoutChecker) clearInterval(timeoutChecker)
                if (settled) return
                settled = true
                reject(new Error(`Failed to run kiro-cli: ${err.message}`))
            })

            child.stdin.write(prompt)
            child.stdin.end()
        })
    }

    private async *runKiroStreamWithRetry(prompt: string): AsyncGenerator<string, void, unknown> {
        for (let attempt = 0; ; attempt++) {
            let yieldedOutput = false
            try {
                for await (const chunk of this.runKiroStreamOnce(prompt)) {
                    yieldedOutput = true
                    yield chunk
                }
                return
            } catch (error) {
                const canRetry = (
                    !yieldedOutput
                    && attempt < KIRO_RETRY_BACKOFF_MS.length
                    && this.isRetryableKiroError(error)
                )
                if (!canRetry) {
                    throw error
                }
                await this.sleep(KIRO_RETRY_BACKOFF_MS[attempt]!)
            }
        }
    }

    private async *runKiroStreamOnce(prompt: string): AsyncGenerator<string, void, unknown> {
        const agent = await this.resolveAgent()

        // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
        const args = ['chat', '--no-interactive', '--trust-all-tools']
        args.push(...this.getModelArgs())
        args.push('--agent', agent)
        if (this.session.sessionId && !this.session.isFirstMessage) {
            args.push('--resume')
        }
        // Pass prompt via stdin to avoid E2BIG when prompt is large

        const child = spawn('kiro-cli', args, {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        const chunks: string[] = []
        let resolveNext: ((value: { chunk: string | null }) => void) | null = null
        let done = false
        let error: Error | null = null
        let stderrOutput = ''
        let lastActivity = Date.now()
        const checkInterval = this.getTimeoutCheckInterval()

        // Timeout checker - kill if no activity for too long
        const timeoutChecker = this.timeout > 0 ? setInterval(() => {
            if (Date.now() - lastActivity > this.timeout) {
                if (timeoutChecker) clearInterval(timeoutChecker)
                child.kill('SIGTERM')
                done = true
                error = new Error(`kiro-cli timed out after ${this.timeout / 1000}s of inactivity`)
                if (resolveNext) {
                    resolveNext({ chunk: null })
                }
            }
        }, checkInterval) : null

        child.stdout.on('data', (data) => {
            lastActivity = Date.now()
            const chunk = this.stripAnsiCodes(data.toString())
            if (chunk) {
                if (resolveNext) {
                    resolveNext({ chunk })
                    resolveNext = null
                } else {
                    chunks.push(chunk)
                }
            }
        })

        child.stderr.on('data', (data) => {
            lastActivity = Date.now()  // Activity on stderr also counts
            stderrOutput += data.toString()
        })

        child.on('close', (code) => {
            if (timeoutChecker) clearInterval(timeoutChecker)
            done = true
            if (code !== 0 && !error) {
                error = this.formatCliExitError(code, stderrOutput)
            }
            if (resolveNext) {
                resolveNext({ chunk: null })
            }
        })

        child.on('error', (err) => {
            if (timeoutChecker) clearInterval(timeoutChecker)
            done = true
            error = new Error(`Failed to run kiro-cli: ${err.message}`)
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

    /** Strip ANSI escape codes from Kiro CLI output */
    private stripAnsiCodes(str: string): string {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1B\][^\x07]*\x07/g, '')   // OSC sequences
            .replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    }
}

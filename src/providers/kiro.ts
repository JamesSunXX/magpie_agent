import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'
import { ensureKiroInstall } from './kiro-install.js'

export class KiroProvider implements AIProvider {
    name = 'kiro'
    private cwd: string
    private timeout: number  // ms, 0 = no timeout
    private readonly logicalName?: string
    private readonly desiredAgent?: string
    private session = new CliSessionHelper()

    get sessionId() { return this.session.sessionId }

    constructor(options?: ProviderOptions) {
        // No API key needed for Kiro CLI (uses AWS subscription)
        this.cwd = process.cwd()
        this.logicalName = options?.logicalName
        this.desiredAgent = options?.agent
        const envTimeout = process.env.MAGPIE_KIRO_TIMEOUT_MS
        const parsedTimeout = envTimeout ? Number(envTimeout) : Number.NaN
        if (Number.isFinite(parsedTimeout) && parsedTimeout >= 0) {
            this.timeout = Math.floor(parsedTimeout)
        } else {
            this.timeout = 15 * 60 * 1000  // 15 minutes default
        }
    }

    setCwd(cwd: string) {
        this.cwd = cwd
    }

    startSession(name?: string): void {
        this.session.start(name)
    }

    endSession(): void {
        this.session.end()
    }

    async resolveAgent(): Promise<string> {
        const sourceDir = join(this.cwd, 'agents', 'kiro-config')
        if (!existsSync(sourceDir)) {
            const bindingHint = this.logicalName ? ` (binding: ${this.logicalName})` : ''
            throw new Error(`Kiro config source not found: ${sourceDir}${bindingHint}`)
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
        const result = await this.runKiro(this.attachImageRefs(prompt, options))
        this.session.markMessageSent()
        return result
    }

    async *chatStream(messages: Message[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
        const prompt = this.session.shouldSendFullHistory()
            ? this.session.buildPrompt(messages, systemPrompt)
            : this.session.buildPromptLastOnly(messages)
        yield* this.runKiroStream(prompt)
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

    private getTimeoutCheckInterval(): number {
        if (this.timeout <= 0) return 0
        // Keep timeout checks responsive while avoiding tight polling loops.
        return Math.min(10000, Math.max(200, Math.floor(this.timeout / 5)))
    }

    private async runKiro(prompt: string): Promise<string> {
        const agent = await this.resolveAgent()

        return new Promise((resolve, reject) => {
            // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
            const args = ['chat', '--no-interactive', '--trust-all-tools']
            args.push('--agent', agent)
            if (this.session.sessionId && !this.session.isFirstMessage) {
                args.push('--resume')
            }
            // Pass prompt as argument
            args.push(prompt)

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
                    reject(new Error(`kiro-cli exited with code ${code}: ${error}`))
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
        })
    }

    private async *runKiroStream(prompt: string): AsyncGenerator<string, void, unknown> {
        const agent = await this.resolveAgent()

        // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
        const args = ['chat', '--no-interactive', '--trust-all-tools']
        args.push('--agent', agent)
        if (this.session.sessionId && !this.session.isFirstMessage) {
            args.push('--resume')
        }
        // Pass prompt as argument
        args.push(prompt)

        const child = spawn('kiro-cli', args, {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        const chunks: string[] = []
        let resolveNext: ((value: { chunk: string | null }) => void) | null = null
        let done = false
        let error: Error | null = null
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

        child.stderr.on('data', (_data) => {
            lastActivity = Date.now()  // Activity on stderr also counts
        })

        child.on('close', (code) => {
            if (timeoutChecker) clearInterval(timeoutChecker)
            done = true
            if (code !== 0 && !error) {
                error = new Error(`kiro-cli exited with code ${code}`)
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

import { spawn } from 'child_process'
import type { AIProvider, Message, ProviderOptions, ChatOptions } from './types.js'
import { CliSessionHelper } from './session-helper.js'

export class KiroProvider implements AIProvider {
    name = 'kiro'
    private cwd: string
    private timeout: number  // ms, 0 = no timeout
    private session = new CliSessionHelper()

    get sessionId() { return this.session.sessionId }

    constructor(_options?: ProviderOptions) {
        // No API key needed for Kiro CLI (uses AWS subscription)
        this.cwd = process.cwd()
        this.timeout = 15 * 60 * 1000  // 15 minutes default
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

    async chat(messages: Message[], systemPrompt?: string, _options?: ChatOptions): Promise<string> {
        const prompt = this.session.shouldSendFullHistory()
            ? this.session.buildPrompt(messages, systemPrompt)
            : this.session.buildPromptLastOnly(messages)
        const result = await this.runKiro(prompt)
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

    private runKiro(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
            const args = ['chat', '--no-interactive', '--trust-all-tools']
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

            child.stdout.on('data', (data) => {
                output += data.toString()
            })

            child.stderr.on('data', (data) => {
                error += data.toString()
            })

            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`kiro-cli exited with code ${code}: ${error}`))
                } else {
                    resolve(this.stripAnsiCodes(output).trim())
                }
            })

            child.on('error', (err) => {
                reject(new Error(`Failed to run kiro-cli: ${err.message}`))
            })
        })
    }

    private async *runKiroStream(prompt: string): AsyncGenerator<string, void, unknown> {
        // kiro chat: --no-interactive for non-interactive mode, --trust-all-tools to auto-approve
        const args = ['chat', '--no-interactive', '--trust-all-tools']
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

        // Timeout checker - kill if no activity for too long
        const timeoutChecker = this.timeout > 0 ? setInterval(() => {
            if (Date.now() - lastActivity > this.timeout) {
                child.kill('SIGTERM')
                done = true
                error = new Error(`kiro-cli timed out after ${this.timeout / 1000}s of inactivity`)
                if (resolveNext) {
                    resolveNext({ chunk: null })
                }
            }
        }, 10000) : null  // Check every 10s

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

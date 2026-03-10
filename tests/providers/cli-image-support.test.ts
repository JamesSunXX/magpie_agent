import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeProvider } from '../../src/providers/claude-code.js'
import { CodexCliProvider } from '../../src/providers/codex.js'
import { GeminiCliProvider } from '../../src/providers/gemini-cli.js'
import { KiroProvider } from '../../src/providers/kiro.js'

interface SpawnCallRecord {
  cmd: string
  args: string[]
  cwd?: string
  prompt: string
}

const spawnCalls: SpawnCallRecord[] = []

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts?: { cwd?: string }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: (chunk: string) => void; end: () => void }
    }

    const call: SpawnCallRecord = {
      cmd,
      args: [...args],
      cwd: opts?.cwd,
      prompt: '',
    }
    spawnCalls.push(call)

    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      const output = (() => {
        if (cmd === 'codex') {
          return `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex response' } })}\n`
        }
        if (cmd === 'gemini') {
          return JSON.stringify({ response: 'Gemini response', session_id: 'session-1' })
        }
        if (cmd === 'kiro-cli') {
          return 'Kiro response'
        }
        return 'Claude response'
      })()

      child.stdout.emit('data', Buffer.from(output))
      setImmediate(() => child.emit('close', 0))
    }

    child.stdin = {
      write: (chunk: string) => {
        call.prompt += chunk
      },
      end: () => {
        finish()
      },
    }

    // Kiro provider passes prompt as argv and won't call stdin.end()
    if (cmd === 'kiro-cli') {
      setImmediate(() => finish())
    }

    return child
  })
}))

beforeEach(() => {
  spawnCalls.length = 0
})

describe('CLI providers image passthrough', () => {
  it('injects image paths into claude prompt', async () => {
    const provider = new ClaudeCodeProvider()
    const result = await provider.chat(
      [{ role: 'user', content: '请做分析' }],
      undefined,
      {
        images: [
          { source: '/tmp/diagram.png', label: '架构图' },
          { source: 'https://example.com/flow.png' },
        ],
      }
    )

    expect(result).toBe('Claude response')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('claude')
    expect(spawnCalls[0].prompt).toContain('架构图: /tmp/diagram.png')
    expect(spawnCalls[0].prompt).toContain('https://example.com/flow.png')
  })

  it('passes local images to codex --image and keeps remote URLs in prompt fallback', async () => {
    const provider = new CodexCliProvider()
    const result = await provider.chat(
      [{ role: 'user', content: '请看图总结' }],
      undefined,
      {
        images: [
          { source: '/tmp/seq.png' },
          { source: 'https://example.com/remote.png' },
        ],
      }
    )

    expect(result).toBe('Codex response')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('codex')
    expect(spawnCalls[0].args).toContain('--image')
    expect(spawnCalls[0].args).toContain('/tmp/seq.png')
    expect(spawnCalls[0].args).not.toContain('https://example.com/remote.png')
    expect(spawnCalls[0].prompt).toContain('RemoteImage1: https://example.com/remote.png')
  })

  it('injects @{} image references into gemini prompt', async () => {
    const provider = new GeminiCliProvider()
    await provider.chat(
      [{ role: 'user', content: '请识别图片信息' }],
      undefined,
      {
        images: [
          { source: '/tmp/arch.png' },
          { source: 'https://example.com/ui.png' },
        ],
      }
    )

    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('gemini')
    expect(spawnCalls[0].prompt).toContain('@{/tmp/arch.png}')
    expect(spawnCalls[0].prompt).toContain('@{https://example.com/ui.png}')
  })

  it('injects image references into kiro prompt', async () => {
    const provider = new KiroProvider()
    const result = await provider.chat(
      [{ role: 'user', content: '请结合图片评审方案' }],
      undefined,
      {
        images: [
          { source: '/tmp/infra.png', label: '基础架构图' },
          { source: 'https://example.com/flow2.png' },
        ],
      }
    )

    expect(result).toBe('Kiro response')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('kiro-cli')
    const kiroPromptArg = spawnCalls[0].args[spawnCalls[0].args.length - 1]
    expect(kiroPromptArg).toContain('@{/tmp/infra.png}')
    expect(kiroPromptArg).toContain('@{https://example.com/flow2.png}')
    expect(kiroPromptArg).toContain('基础架构图: /tmp/infra.png')
  })
})

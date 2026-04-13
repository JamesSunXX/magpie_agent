import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { AIProvider, Message } from '../../../src/platform/providers/index.js'
import {
  defaultAutoCommitMessage,
  generateAutoCommitMessage,
} from '../../../src/capabilities/loop/domain/auto-commit-message.js'

class StubProvider implements AIProvider {
  name = 'stub'

  constructor(
    private readonly responder: (messages: Message[], systemPrompt?: string) => Promise<string>
  ) {}

  chat(messages: Message[], systemPrompt?: string): Promise<string> {
    return this.responder(messages, systemPrompt)
  }

  async *chatStream(): AsyncGenerator<string, void, unknown> {
    yield ''
  }
}

function createRepoWithStagedChange(): string {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-auto-commit-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })

  writeFileSync(join(dir, 'README.md'), '# repo\n', 'utf-8')
  execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "chore: 初始化仓库"', { cwd: dir, stdio: 'pipe' })

  writeFileSync(join(dir, 'feature.txt'), 'new feature\n', 'utf-8')
  execSync('git add feature.txt', { cwd: dir, stdio: 'pipe' })
  return dir
}

describe('auto commit message generator', () => {
  it('uses the AI-generated message when the response is valid', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async (_messages, systemPrompt) => {
      expect(systemPrompt).toContain('使用中文生成简洁的 Git 提交信息')
      return 'fix(loop):收敛自动提交文案'
    })

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe('fix(loop):收敛自动提交文案')
    expect(result.source).toBe('ai')
  })

  it('does not include raw staged file content in the AI summary prompt', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-auto-commit-secret-'))
    execSync('git init', { cwd, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd, stdio: 'pipe' })

    writeFileSync(join(cwd, 'README.md'), '# repo\n', 'utf-8')
    execSync('git add README.md', { cwd, stdio: 'pipe' })
    execSync('git commit -m "chore: 初始化仓库"', { cwd, stdio: 'pipe' })

    writeFileSync(join(cwd, 'secret.txt'), 'api_key=super-secret-value\n', 'utf-8')
    execSync('git add secret.txt', { cwd, stdio: 'pipe' })

    const provider = new StubProvider(async (messages) => {
      const prompt = String(messages[0]?.content ?? '')
      expect(prompt).toContain('[name-status]')
      expect(prompt).toContain('[numstat]')
      expect(prompt).toContain('[stat]')
      expect(prompt).not.toContain('[patch]')
      expect(prompt).not.toContain('api_key=super-secret-value')
      return 'fix(loop):保护自动提交摘要'
    })

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe('fix(loop):保护自动提交摘要')
    expect(result.source).toBe('ai')
  })

  it('falls back to the default message when the AI response is invalid', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async () => '这里是一段解释，不是提交标题')

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe(defaultAutoCommitMessage('code_development'))
    expect(result.source).toBe('fallback')
    expect(result.reason).toBe('invalid_message')
  })

  it('accepts a commit title when the AI wraps it with a short prefix line', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async () => '提交信息：\nfix(loop):修正自动提交文案')

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe('fix(loop):修正自动提交文案')
    expect(result.source).toBe('ai')
  })

  it('normalizes a full-width colon in the AI-generated title', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async () => 'fix(loop)：修正自动提交文案')

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe('fix(loop):修正自动提交文案')
    expect(result.source).toBe('ai')
  })

  it('falls back when the AI title exceeds the configured 50-character limit', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async () => 'fix(loop):abcdefghijklmnopqrstuvwxyz1234567890abcdefghijk')

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'code_development',
      provider,
    })

    expect(result.message).toBe(defaultAutoCommitMessage('code_development'))
    expect(result.source).toBe('fallback')
    expect(result.reason).toBe('invalid_message')
  })

  it('falls back to the default message when the provider throws', async () => {
    const cwd = createRepoWithStagedChange()
    const provider = new StubProvider(async () => {
      throw new Error('provider unavailable')
    })

    const result = await generateAutoCommitMessage({
      cwd,
      stage: 'integration_test',
      provider,
    })

    expect(result.message).toBe(defaultAutoCommitMessage('integration_test'))
    expect(result.source).toBe('fallback')
    expect(result.reason).toContain('provider unavailable')
  })
})

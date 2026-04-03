import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function cloneFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kiro-src-'))
  const source = join(root, 'kiro-config')
  cpSync(join(process.cwd(), 'agents', 'kiro-config'), source, { recursive: true })
  rmSync(join(source, '.git'), { recursive: true, force: true })
  return source
}

describe('kiro install script', () => {
  it('writes metadata and skips backup for identical files', () => {
    const source = cloneFixture()
    const home = mkdtempSync(join(tmpdir(), 'kiro-home-'))
    const script = join(source, 'install.sh')

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    expect(existsSync(join(home, '.magpie', 'kiro-install.json'))).toBe(true)
    expect(existsSync(join(home, '.magpie-backups'))).toBe(false)
  })

  it('backs up changed managed files before overwrite', () => {
    const source = cloneFixture()
    const home = mkdtempSync(join(tmpdir(), 'kiro-home-'))
    const script = join(source, 'install.sh')
    writeFileSync(join(source, 'prompts', 'code_review.md'), 'prompt-v2', 'utf-8')
    mkdirSync(join(home, 'prompts'), { recursive: true })
    writeFileSync(join(home, 'prompts', 'code_review.md'), 'prompt-v1', 'utf-8')

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    expect(readFileSync(join(home, 'prompts', 'code_review.md'), 'utf-8')).toBe('prompt-v2')
    expect(existsSync(join(home, '.magpie-backups'))).toBe(true)
  })
})

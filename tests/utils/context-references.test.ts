import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProjectMemoryPath } from '../../src/memory/runtime.js'
import { resolveContextReferences } from '../../src/utils/context-references.js'

describe('resolveContextReferences', () => {
  let cwd: string | undefined
  let magpieHome: string | undefined

  afterEach(() => {
    vi.unstubAllGlobals()
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true })
      cwd = undefined
    }
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('expands file, directory, diff, and memory references', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-context-ref-'))
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-context-home-'))
    process.env.MAGPIE_HOME = magpieHome

    mkdirSync(join(cwd, 'src', 'nested'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'app.ts'), 'export const app = true\n', 'utf-8')
    writeFileSync(join(cwd, 'src', 'nested', 'worker.ts'), 'export const worker = true\n', 'utf-8')
    mkdirSync(join(magpieHome, 'memories'), { recursive: true })
    writeFileSync(join(magpieHome, 'memories', 'USER.md'), '# User Memory\n\n- Reply with examples.\n', 'utf-8')
    const projectPath = getProjectMemoryPath(cwd)
    mkdirSync(join(projectPath, '..'), { recursive: true })
    writeFileSync(projectPath, '# Project Memory\n\n- Keep CLI output short.\n', 'utf-8')

    execFileSync('git', ['init'], { cwd, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd, stdio: 'pipe' })
    execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd, stdio: 'pipe' })
    writeFileSync(join(cwd, 'src', 'app.ts'), 'export const app = false\n', 'utf-8')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => 'Remote context body',
    })))

    const resolved = await resolveContextReferences(
      'See @file:src/app.ts @dir:src @diff @user-memory @project-memory @url:https://example.com/context.txt',
      { cwd }
    )

    expect(resolved).toContain('[file] src/app.ts')
    expect(resolved).toContain('export const app = false')
    expect(resolved).toContain('[directory] src')
    expect(resolved).toContain('nested/worker.ts')
    expect(resolved).toContain('[diff] HEAD')
    expect(resolved).toContain('Reply with examples.')
    expect(resolved).toContain('Keep CLI output short.')
    expect(resolved).toContain('Remote context body')
  })

  it('rejects references that escape the current repository', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-context-ref-'))

    await expect(resolveContextReferences('Check @file:../secret.txt', { cwd })).rejects.toThrow(
      'Context reference must stay within the current repository'
    )
  })

  it('ignores trailing sentence punctuation around references', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-context-punctuation-'))
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1\n', 'utf-8')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => 'Remote punctuation body',
    })))

    const resolved = await resolveContextReferences(
      'Review @file:src/a.ts. See (@url:https://example.com/context.txt).',
      { cwd }
    )

    expect(resolved).toContain('[file] src/a.ts')
    expect(resolved).toContain('Remote punctuation body')
  })

  it('keeps a closing parenthesis when it is part of the referenced URL', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-context-url-paren-'))

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      text: async () => String(input),
    })))

    const resolved = await resolveContextReferences(
      '@url:https://example.com/Foo_(bar)',
      { cwd }
    )

    expect(resolved).toContain('[url] https://example.com/Foo_(bar)')
    expect(resolved).toContain('https://example.com/Foo_(bar)')
  })
})

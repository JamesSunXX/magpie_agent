import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { prepareDiscussInput } from '../../../src/capabilities/discuss/application/prepare.js'
import { loadConfig } from '../../../src/platform/config/loader.js'

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfig: vi.fn(),
}))

describe('discuss capability prepare', () => {
  let magpieHome: string | undefined

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('normalizes top-level discuss flags into options', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Should we adopt monorepo?',
      rounds: '2',
      reviewers: 'claude',
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(prepared.options).toEqual(expect.objectContaining({
      rounds: '2',
      reviewers: 'claude',
    }))
  })

  it('loads config into prepared input', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Should we adopt monorepo?',
      options: {
        reviewers: 'claude',
      },
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(loadConfig).toHaveBeenCalledWith('/tmp/magpie.yaml')
    expect(prepared.config).toBe(config)
    expect(prepared.topic).toBe('Should we adopt monorepo?')
    expect(prepared.options).toEqual(expect.objectContaining({
      reviewers: 'claude',
      rounds: '5',
      format: 'markdown',
    }))
  })

  it('auto-selects routed discuss reviewers when routing is enabled and reviewers are not provided', async () => {
    const config = {
      reviewers: {
        'route-gemini': { model: 'gemini-cli', prompt: 'route gemini' },
        'route-codex': { model: 'codex', prompt: 'route codex' },
        'route-architect': { model: 'kiro', agent: 'architect', prompt: 'route architect' },
      },
      capabilities: {
        discuss: {
          enabled: true,
        },
        routing: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Discuss payment database migration, auth rollback compatibility, public API changes, external integration risk, concurrency concerns, and performance constraints.',
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(prepared.options.reviewers).toBe('route-codex,route-architect')
  })

  it('expands context references in the discuss topic', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-discuss-memory-'))
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(magpieHome, 'memories'), { recursive: true })
    writeFileSync(join(magpieHome, 'memories', 'USER.md'), '# User Memory\n\n- Prefer direct answers.\n', 'utf-8')

    const cwd = mkdtempSync(join(tmpdir(), 'magpie-discuss-cwd-'))
    const srcDir = join(cwd, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sample.ts'), 'export const sample = 1\n', 'utf-8')

    const prepared = await prepareDiscussInput({
      topic: 'Review @file:src/sample.ts and @user-memory',
    }, createCapabilityContext({ cwd, configPath: '/tmp/magpie.yaml' }))

    expect(prepared.topic).toContain('src/sample.ts')
    expect(prepared.topic).toContain('export const sample = 1')
    expect(prepared.topic).toContain('Prefer direct answers.')
  })
})

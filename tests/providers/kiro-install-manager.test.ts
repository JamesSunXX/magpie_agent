import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import {
  ensureKiroInstall,
  getKiroHome,
  getKiroInstallMetadataPath,
  readExpectedKiroSourceVersion,
} from '../../src/providers/kiro-install.js'

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const mockExecFileSync = vi.mocked(execFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)

describe('kiro install manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.KIRO_HOME
  })

  afterEach(() => {
    delete process.env.KIRO_HOME
  })

  it('reads source version from the helper shell script', () => {
    mockExecFileSync.mockReturnValue('abc123\n' as never)

    expect(readExpectedKiroSourceVersion('/repo/agents/kiro-config')).toBe('abc123')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'bash',
      ['-lc', expect.stringContaining('git -C')],
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('installs when managed dirs or metadata are missing and falls back to kiro_default', () => {
    process.env.KIRO_HOME = '/tmp/kiro-home'
    mockExistsSync.mockReturnValue(false)
    mockExecFileSync.mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === '-lc') return 'v1\n' as never
      return '' as never
    })

    const result = ensureKiroInstall({
      sourceDir: '/repo/agents/kiro-config',
      desiredAgent: 'go-reviewer',
    })

    expect(result).toEqual({
      selectedAgent: 'kiro_default',
      installed: true,
    })
    expect(mockExecFileSync.mock.calls.some(([, args]) => Array.isArray(args) && String(args[0]).endsWith('install.sh'))).toBe(true)
  })

  it('skips install when metadata and desired agent already match', () => {
    const home = '/tmp/kiro-home'
    process.env.KIRO_HOME = home
    const metadataPath = `${home}/.magpie/kiro-install.json`
    const agentPath = `${home}/agents/go-reviewer.json`

    mockExistsSync.mockImplementation((path: string | Buffer | URL) => {
      const p = String(path)
      if (p === `${home}/agents`) return true
      if (p === `${home}/prompts`) return true
      if (p === `${home}/skills`) return true
      if (p === `${home}/hooks`) return true
      if (p === metadataPath) return true
      if (p === agentPath) return true
      return false
    })
    mockReadFileSync.mockReturnValue(JSON.stringify({ sourceVersion: 'v2' }) as never)
    mockExecFileSync.mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === '-lc') return 'v2\n' as never
      throw new Error('install should not be called')
    })

    const result = ensureKiroInstall({
      sourceDir: '/repo/agents/kiro-config',
      desiredAgent: 'go-reviewer',
    })

    expect(result).toEqual({
      selectedAgent: 'go-reviewer',
      installed: false,
    })
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('reinstalls when metadata file exists but cannot be parsed', () => {
    const home = '/tmp/kiro-home'
    process.env.KIRO_HOME = home
    const metadataPath = `${home}/.magpie/kiro-install.json`

    mockExistsSync.mockImplementation((path: string | Buffer | URL) => {
      const p = String(path)
      if (p === `${home}/agents`) return true
      if (p === `${home}/prompts`) return true
      if (p === `${home}/skills`) return true
      if (p === `${home}/hooks`) return true
      if (p === metadataPath) return true
      return false
    })
    mockReadFileSync.mockReturnValue('{invalid-json' as never)
    mockExecFileSync.mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === '-lc') return 'v3\n' as never
      return '' as never
    })

    const result = ensureKiroInstall({
      sourceDir: '/repo/agents/kiro-config',
    })

    expect(result).toEqual({
      selectedAgent: 'kiro_default',
      installed: true,
    })
  })

  it('uses env override for KIRO_HOME when provided', () => {
    process.env.KIRO_HOME = '/tmp/override-home'

    expect(getKiroHome()).toBe('/tmp/override-home')
    expect(getKiroInstallMetadataPath()).toBe('/tmp/override-home/.magpie/kiro-install.json')
  })
})

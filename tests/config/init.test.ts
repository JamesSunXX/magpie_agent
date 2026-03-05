// tests/config/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initConfig, DEFAULT_CONFIG } from '../../src/config/init'
import { existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Config Init', () => {
  const testDir = join(tmpdir(), 'magpie-init-test-' + Date.now())

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should create config file with default content', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    initConfig(testDir)

    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('providers:')
    expect(content).toContain('reviewers:')
    expect(content).toContain('trd:')
    expect(content).toContain('default_reviewers:')
    expect(content).not.toContain('image_reader:')
  })

  it('should not overwrite existing config', () => {
    initConfig(testDir)
    expect(() => initConfig(testDir)).toThrow(/already exists/)
  })
})

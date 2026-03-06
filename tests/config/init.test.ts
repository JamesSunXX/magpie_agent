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
  })

  it('should include notification templates for feishu and iMessage transports', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    initConfig(testDir)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('type: "feishu-webhook"')
    expect(content).toContain('webhook_url: "${FEISHU_WEBHOOK_URL}"')
    expect(content).toContain('type: "imessage"')
    expect(content).toContain('transport: "messages-applescript"')
    expect(content).toContain('transport: "bluebubbles"')
    expect(content).toContain('server_url: "${BLUEBUBBLES_SERVER_URL}"')
    expect(content).toContain('password: "${BLUEBUBBLES_PASSWORD}"')
    expect(content).toContain('chat_guid:${BLUEBUBBLES_CHAT_GUID}')
  })

  it('should not overwrite existing config', () => {
    initConfig(testDir)
    expect(() => initConfig(testDir)).toThrow(/already exists/)
  })
})

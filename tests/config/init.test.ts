// tests/config/init.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { initConfig, generateConfig } from '../../src/platform/config/init.js'
import { existsSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'fs'
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
    expect(content).toContain('capabilities:')
    expect(content).toContain('integrations:')
    expect(content).toContain('trd:')
    expect(content).toContain('default_reviewers:')
    expect(content).not.toContain('image_reader:')
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

  it('should backup existing config before writing a new one', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    const magpieDir = join(testDir, '.magpie')

    initConfig(testDir)
    writeFileSync(configPath, 'legacy: true\n', 'utf-8')

    initConfig(testDir)

    const backupFiles = readdirSync(magpieDir).filter(name => name.startsWith('config.yaml.bak-'))
    expect(backupFiles.length).toBe(1)
    const backupPath = join(magpieDir, backupFiles[0])

    expect(readFileSync(backupPath, 'utf-8')).toBe('legacy: true\n')
    expect(readFileSync(configPath, 'utf-8')).toContain('providers:')
  })

  it('should render interactive notification values when provided', () => {
    const content = generateConfig(
      ['claude-code', 'codex'],
      {
        notifications: {
          feishuWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
          feishuWebhookSecret: 'demo-secret',
          imessageAppleScriptTargets: [
            'handle:+8613800138000',
            'handle:ops@example.com'
          ],
          imessageBluebubblesServerUrl: 'https://bluebubbles.example.com',
          imessageBluebubblesPassword: 'bb-password',
          imessageBluebubblesChatGuid: 'iMessage;-;+8613800138000'
        }
      }
    )

    expect(content).toContain('webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/demo"')
    expect(content).toContain('secret: "demo-secret"')
    expect(content).toContain('- "handle:+8613800138000"')
    expect(content).toContain('- "handle:ops@example.com"')
    expect(content).toContain('server_url: "https://bluebubbles.example.com"')
    expect(content).toContain('password: "bb-password"')
    expect(content).toContain('- "chat_guid:iMessage;-;+8613800138000"')
  })
})

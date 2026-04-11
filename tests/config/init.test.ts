// tests/config/init.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import {
  initConfig,
  generateConfig,
  AVAILABLE_REVIEWERS,
  upgradeConfigWithResult,
} from '../../src/platform/config/init.js'
import { loadConfig } from '../../src/platform/config/loader.js'
import { existsSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import YAML from 'yaml'

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
    expect(content).toContain('config_version:')
    expect(content).toContain('reviewers:')
    expect(content).toContain('capabilities:')
    expect(content).toContain('integrations:')
    expect(content).toContain('trd:')
    expect(content).toContain('default_reviewers:')
    expect(content).toContain('route-gemini:')
    expect(content).toContain('route-codex:')
    expect(content).toContain('route-architect:')
    expect(content).toContain('strategy: "rules_first"')
    expect(content).toContain('allow_runtime_escalation: true')
    expect(content).toContain('fallback_chain:')
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
    expect(content).toContain('stage_ai:')
    expect(content).toContain('provider: "codex"')
    expect(content).toContain('include_loop: true')
    expect(content).toContain('include_harness: true')
    expect(content).toContain('stage_entered: [feishu_team]')
    expect(content).toContain('stage_completed: [feishu_team]')
    expect(content).toContain('stage_failed: [feishu_team]')
    expect(content).toContain('stage_paused: [feishu_team]')
    expect(content).toContain('stage_resumed: [feishu_team]')
  })

  it('should include planning and operations integration templates', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    initConfig(testDir)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('planning:')
    expect(content).toContain('type: "jira"')
    expect(content).toContain('auth_mode: "cloud"')
    expect(content).toContain('type: "feishu-project"')
    expect(content).toContain('operations:')
    expect(content).toContain('type: "local-commands"')
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

  it('upgrades existing v2 config with routing and codex binding fixes', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    const magpieDir = join(testDir, '.magpie')
    mkdirSync(magpieDir, { recursive: true })
    writeFileSync(configPath, `providers: {}
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  codex-cli:
    model: codex-cli
    prompt: review
summarizer:
  model: kiro
  prompt: summarize
analyzer:
  model: kiro
  prompt: analyze
capabilities:
  review:
    enabled: true
  issue_fix:
    enabled: true
    planner_model: codex
    executor_model: codex
    verify_command: "npm run test:run"
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const result = upgradeConfigWithResult(configPath)
    const upgraded = readFileSync(configPath, 'utf-8')
    const backupFiles = readdirSync(magpieDir).filter(name => name.startsWith('config.yaml.bak-'))

    expect(result.written).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(backupFiles.length).toBe(1)
    expect(upgraded).toContain('tool: codex')
    expect(upgraded).not.toContain('model: codex-cli')
    expect(upgraded).toContain('routing:')
    expect(upgraded).toContain('allow_runtime_escalation: true')
    expect(upgraded).toContain('stage_ai:')
    expect(upgraded).toContain('provider: codex')
    expect(upgraded).toContain('stage_entered:')
    expect(upgraded).toContain('- feishu_team')
    expect(result.changes).toContain('Converted reviewers.codex-cli from model: codex-cli to tool: codex.')
    expect(result.changes).toContain('Added capabilities.routing defaults.')
    expect(result.changes).toContain('Filled missing integrations.notifications defaults.')
    expect(result.warnings).toContain('Review repo-specific verification commands before applying this config to a non-Node repository.')
  })

  it('supports dry-run upgrade without writing files', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    mkdirSync(join(testDir, '.magpie'), { recursive: true })
    writeFileSync(configPath, `providers: {}
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  codex-cli:
    model: codex-cli
    prompt: review
summarizer:
  model: kiro
  prompt: summarize
analyzer:
  model: kiro
  prompt: analyze
capabilities:
  review:
    enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const original = readFileSync(configPath, 'utf-8')
    const result = upgradeConfigWithResult(configPath, { dryRun: true })

    expect(result.written).toBe(false)
    expect(result.backupPath).toBeUndefined()
    expect(readFileSync(configPath, 'utf-8')).toBe(original)
    expect(result.content).toContain('routing:')
    expect(result.content).toContain('tool: codex')
    expect(result.content).toContain('stage_ai:')
    expect(result.content).toContain('stage_resumed:')
  })

  it('upgrades legacy codex-cli route bindings so the config can still load', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    mkdirSync(join(testDir, '.magpie'), { recursive: true })
    writeFileSync(configPath, `config_version: 1
providers: {}
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  route-codex:
    tool: codex-cli
    prompt: review
summarizer:
  model: kiro
  prompt: summarize
analyzer:
  model: kiro
  prompt: analyze
capabilities:
  review:
    enabled: true
  routing:
    enabled: true
    stage_policies:
      planning:
        standard:
          tool: codex-cli
    fallback_chain:
      execution:
        standard:
          - tool: codex-cli
  issue_fix:
    enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const result = upgradeConfigWithResult(configPath)
    const upgraded = readFileSync(configPath, 'utf-8')

    expect(upgraded).not.toContain('tool: codex-cli')
    expect(upgraded).toContain('tool: codex')
    expect(result.changes).toContain('Converted reviewers.route-codex from tool: codex-cli to tool: codex.')
    expect(result.changes).toContain('Converted capabilities.routing.stage_policies.planning.standard from tool: codex-cli to tool: codex.')
    expect(result.changes).toContain('Converted capabilities.routing.fallback_chain.execution.standard[0] from tool: codex-cli to tool: codex.')
    expect(() => loadConfig(configPath)).not.toThrow()
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

  it('loads stage-aware notification config from generated yaml', () => {
    const configPath = join(testDir, '.magpie', 'config.yaml')
    mkdirSync(join(testDir, '.magpie'), { recursive: true })
    writeFileSync(configPath, `providers: {}
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  route-codex:
    tool: codex
    prompt: review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  review:
    enabled: true
integrations:
  notifications:
    enabled: true
    stage_ai:
      enabled: true
      provider: codex
      max_summary_chars: 700
      include_loop: true
      include_harness: false
    routes:
      stage_entered:
        - feishu_team
    providers:
      feishu_team:
        type: feishu-webhook
        webhook_url: https://example.com/hook
`, 'utf-8')

    const config = loadConfig(configPath)
    expect(config.integrations.notifications?.stage_ai?.enabled).toBe(true)
    expect(config.integrations.notifications?.stage_ai?.provider).toBe('codex')
    expect(config.integrations.notifications?.stage_ai?.max_summary_chars).toBe(700)
    expect(config.integrations.notifications?.stage_ai?.include_loop).toBe(true)
    expect(config.integrations.notifications?.stage_ai?.include_harness).toBe(false)
    expect(config.integrations.notifications?.routes?.stage_entered).toEqual(['feishu_team'])
    expect(config.integrations.notifications?.routes?.stage_completed).toBeUndefined()
  })

  it('should render interactive planning and operations values when provided', () => {
    const content = generateConfig(
      ['claude-code', 'codex'],
      {
        planning: {
          enabled: true,
          defaultProvider: 'feishu_project',
          jiraBaseUrl: 'https://jira.example.com',
          jiraProjectKey: 'ENG',
          jiraAuthMode: 'cloud',
          jiraEmail: 'jira@example.com',
          jiraApiToken: 'jira-token',
          feishuBaseUrl: 'https://project.feishu.cn',
          feishuProjectKey: 'OPS',
          feishuAppId: 'app-id',
          feishuAppSecret: 'app-secret',
        },
        operations: {
          enabled: true,
          defaultProvider: 'ops_main',
          timeoutMs: 120000,
          maxBufferBytes: 2048,
        }
      }
    )

    expect(content).toContain('planning:')
    expect(content).toContain('enabled: true')
    expect(content).toContain('default_provider: "feishu_project"')
    expect(content).toContain('base_url: "https://jira.example.com"')
    expect(content).toContain('auth_mode: "cloud"')
    expect(content).toContain('email: "jira@example.com"')
    expect(content).toContain('api_token: "jira-token"')
    expect(content).toContain('project_key: "OPS"')
    expect(content).toContain('app_id: "app-id"')
    expect(content).toContain('app_secret: "app-secret"')
    expect(content).toContain('operations:')
    expect(content).toContain('default_provider: "ops_main"')
    expect(content).toContain('timeout_ms: 120000')
    expect(content).toContain('max_buffer_bytes: 2048')
  })

  it('should render jira basic auth planning values when provided', () => {
    const content = generateConfig(
      ['claude-code', 'codex'],
      {
        planning: {
          enabled: true,
          defaultProvider: 'jira_main',
          jiraBaseUrl: 'https://jira.example.com',
          jiraProjectKey: 'OPS',
          jiraAuthMode: 'basic',
          jiraUsername: 'jira-user',
          jiraPassword: 'jira-password',
        },
      }
    )

    expect(content).toContain('default_provider: "jira_main"')
    expect(content).toContain('auth_mode: "basic"')
    expect(content).toContain('username: "jira-user"')
    expect(content).toContain('password: "jira-password"')
    expect(content).not.toContain('email: ')
    expect(content).not.toContain('api_token: ')
  })

  it('exposes claw as an interactive reviewer option', () => {
    const claw = AVAILABLE_REVIEWERS.find((reviewer) => reviewer.id === 'claw')
    expect(claw?.model).toBe('claw')
    expect(claw?.needsApiKey).toBe(false)
  })

  it('generates config that can be parsed when route reviewers are included', () => {
    const content = generateConfig(['gemini-cli', 'codex', 'kiro'])
    const parsed = YAML.parse(content) as {
      reviewers: Record<string, { tool?: string; model?: string; agent?: string }>
      capabilities: {
        routing: {
          fallback_chain: {
            planning: {
              complex: Array<{ tool?: string; model?: string }>
            }
          }
        }
      }
    }

    expect(parsed.reviewers['route-gemini']).toMatchObject({ tool: 'gemini' })
    expect(parsed.reviewers['route-codex']).toMatchObject({ tool: 'codex' })
    expect(parsed.reviewers['route-architect']).toMatchObject({ tool: 'kiro', agent: 'architect' })
    expect(parsed.capabilities.routing.fallback_chain.planning.complex).toEqual([
      { tool: 'codex' },
      { tool: 'gemini' },
    ])
  })

  it('gives each built-in route reviewer a distinct prompt block', () => {
    const content = generateConfig(['gemini-cli', 'codex', 'kiro'])

    expect(content).toContain('- local correctness')
    expect(content).toContain('- business logic and edge cases')
    expect(content).toContain('- architecture and trade-offs')
  })
})

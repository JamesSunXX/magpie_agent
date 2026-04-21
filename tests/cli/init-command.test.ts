import { beforeEach, describe, expect, it, vi } from 'vitest'

function askFromAnswers(answers: string[]) {
  return async () => answers.shift() || ''
}

describe('init CLI command helpers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('parses reviewer selections with dedupe and invalid filtering', async () => {
    const { parseReviewerSelection } = await import('../../src/cli/commands/init.js')

    const result = parseReviewerSelection(
      '2, 1, 2, 99, foo',
      [
        {
          id: 'claude-code',
          name: 'Claude Code',
          model: 'claude-code',
          description: 'Uses your Claude Code subscription',
          needsApiKey: false,
        },
        {
          id: 'codex',
          name: 'Codex CLI',
          model: 'codex',
          description: 'Uses your OpenAI Codex CLI subscription',
          needsApiKey: false,
        },
      ]
    )

    expect(result).toEqual(['codex', 'claude-code'])
  })

  it('collects notification options from prompted answers', async () => {
    const { promptForNotificationOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForNotificationOptions(askFromAnswers([
      'https://open.feishu.cn/hook/demo',
      'feishu-secret',
      'handle:+8613800138000, handle:ops@example.com',
      'https://bluebubbles.example.com',
      'bb-password',
      'iMessage;-;+8613800138000',
    ]))

    expect(result).toEqual({
      feishuWebhookUrl: 'https://open.feishu.cn/hook/demo',
      feishuWebhookSecret: 'feishu-secret',
      imessageAppleScriptTargets: ['handle:+8613800138000', 'handle:ops@example.com'],
      imessageBluebubblesServerUrl: 'https://bluebubbles.example.com',
      imessageBluebubblesPassword: 'bb-password',
      imessageBluebubblesChatGuid: 'iMessage;-;+8613800138000',
    })
  })

  it('returns undefined notification options when all answers are blank', async () => {
    const { promptForNotificationOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForNotificationOptions(askFromAnswers(['', '', '', '', '', '']))

    expect(result).toBeUndefined()
  })

  it('collects jira planning options when enabled', async () => {
    const { promptForPlanningOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForPlanningOptions(askFromAnswers([
      'y',
      '1',
      '1',
      'https://jira.example.com',
      'ENG',
      'jira@example.com',
      'jira-token',
    ]))

    expect(result).toEqual({
      enabled: true,
      defaultProvider: 'jira_main',
      jiraAuthMode: 'cloud',
      jiraBaseUrl: 'https://jira.example.com',
      jiraProjectKey: 'ENG',
      jiraEmail: 'jira@example.com',
      jiraApiToken: 'jira-token',
    })
  })

  it('collects jira basic auth planning options when selected', async () => {
    const { promptForPlanningOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForPlanningOptions(askFromAnswers([
      'y',
      '1',
      '2',
      'https://jira.example.com',
      'OPS',
      'jira-user',
      'jira-password',
    ]))

    expect(result).toEqual({
      enabled: true,
      defaultProvider: 'jira_main',
      jiraAuthMode: 'basic',
      jiraBaseUrl: 'https://jira.example.com',
      jiraProjectKey: 'OPS',
      jiraUsername: 'jira-user',
      jiraPassword: 'jira-password',
    })
  })

  it('collects feishu planning options when selected', async () => {
    const { promptForPlanningOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForPlanningOptions(askFromAnswers([
      'yes',
      '2',
      'https://project.feishu.cn',
      'OPS',
      'app-id',
      'app-secret',
    ]))

    expect(result).toEqual({
      enabled: true,
      defaultProvider: 'feishu_project',
      feishuBaseUrl: 'https://project.feishu.cn',
      feishuProjectKey: 'OPS',
      feishuAppId: 'app-id',
      feishuAppSecret: 'app-secret',
    })
  })

  it('returns undefined planning options when disabled', async () => {
    const { promptForPlanningOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForPlanningOptions(askFromAnswers(['n']))

    expect(result).toBeUndefined()
  })

  it('collects operations options when enabled', async () => {
    const { promptForOperationsOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForOperationsOptions(askFromAnswers([
      'y',
      'ops_main',
      '120000',
      '2048',
    ]))

    expect(result).toEqual({
      enabled: true,
      defaultProvider: 'ops_main',
      timeoutMs: 120000,
      maxBufferBytes: 2048,
    })
  })

  it('returns undefined operations options when disabled', async () => {
    const { promptForOperationsOptions } = await import('../../src/cli/commands/init.js')

    const result = await promptForOperationsOptions(askFromAnswers(['n']))

    expect(result).toBeUndefined()
  })

  it('parses onboarding profile answers with local development as default', async () => {
    const { parseInitProfileSelection } = await import('../../src/cli/commands/init.js')

    expect(parseInitProfileSelection('')).toBe('local')
    expect(parseInitProfileSelection('2')).toBe('team')
    expect(parseInitProfileSelection('3')).toBe('background')
    expect(parseInitProfileSelection('unknown')).toBe('local')
  })

  it('collects planning and operations options during interactive init', async () => {
    const log = vi.fn()
    const { collectInitInputs } = await import('../../src/cli/commands/init.js')

    const result = await collectInitInputs(
      { yes: false },
      {
        availableReviewers: [
          {
            id: 'claude-code',
            name: 'Claude Code',
            model: 'claude-code',
            description: 'Uses your Claude Code subscription',
            needsApiKey: false,
          },
          {
            id: 'codex',
            name: 'Codex CLI',
            model: 'codex',
            description: 'Uses your OpenAI Codex CLI subscription',
            needsApiKey: false,
          },
        ],
        selectProfile: async () => 'team',
        selectReviewers: async () => ['claude-code', 'codex'],
        selectNotificationOptions: async () => undefined,
        selectPlanningOptions: async () => ({
          enabled: true,
          defaultProvider: 'feishu_project',
          feishuBaseUrl: 'https://project.feishu.cn',
          feishuProjectKey: 'OPS',
          feishuAppId: 'app-id',
          feishuAppSecret: 'app-secret',
        }),
        selectOperationsOptions: async () => ({
          enabled: true,
          defaultProvider: 'ops_main',
          timeoutMs: 120000,
          maxBufferBytes: 2048,
        }),
        log,
      }
    )

    expect(result).toEqual({
      profile: 'team',
      selectedReviewers: ['claude-code', 'codex'],
      notificationOptions: undefined,
      planningOptions: {
        enabled: true,
        defaultProvider: 'feishu_project',
        feishuBaseUrl: 'https://project.feishu.cn',
        feishuProjectKey: 'OPS',
        feishuAppId: 'app-id',
        feishuAppSecret: 'app-secret',
      },
      operationsOptions: {
        enabled: true,
        defaultProvider: 'ops_main',
        timeoutMs: 120000,
        maxBufferBytes: 2048,
      },
    })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Selected reviewers:'))
  })

  it('falls back to default reviewers and prints API key hints', async () => {
    const log = vi.fn()
    const { collectInitInputs } = await import('../../src/cli/commands/init.js')

    const result = await collectInitInputs(
      { yes: false },
      {
        availableReviewers: [
          {
            id: 'claude-code',
            name: 'Claude Code',
            model: 'claude-code',
            description: 'Uses your Claude Code subscription',
            needsApiKey: false,
          },
          {
            id: 'codex',
            name: 'Codex CLI',
            model: 'codex',
            description: 'Uses your OpenAI Codex CLI subscription',
            needsApiKey: false,
          },
          {
            id: 'gpt',
            name: 'GPT-5.2',
            model: 'gpt-5.2',
            description: 'Uses OpenAI API',
            needsApiKey: true,
            provider: 'openai',
          },
        ],
        selectProfile: async () => 'local',
        selectReviewers: async () => [],
        selectNotificationOptions: async () => undefined,
        selectPlanningOptions: async () => undefined,
        selectOperationsOptions: async () => undefined,
        log,
      }
    )

    expect(result.selectedReviewers).toEqual(['claude-code', 'codex'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Using defaults'))

    const apiKeyResult = await collectInitInputs(
      { yes: false },
      {
        availableReviewers: [
          {
            id: 'gpt',
            name: 'GPT-5.2',
            model: 'gpt-5.2',
            description: 'Uses OpenAI API',
            needsApiKey: true,
            provider: 'openai',
          },
        ],
        selectProfile: async () => 'local',
        selectReviewers: async () => ['gpt'],
        selectNotificationOptions: async () => undefined,
        selectPlanningOptions: async () => undefined,
        selectOperationsOptions: async () => undefined,
        log,
      }
    )

    expect(apiKeyResult.selectedReviewers).toEqual(['gpt'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'))
  })

  it('writes config and reports backup path for --yes', async () => {
    vi.doMock('../../src/platform/config/init.js', () => ({
      AVAILABLE_REVIEWERS: [],
      initConfigWithResult: vi.fn(() => ({
        configPath: '/tmp/.magpie/config.yaml',
        backupPath: '/tmp/.magpie/config.yaml.bak-1',
      })),
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { initCommand } = await import('../../src/cli/commands/init.js')

    await initCommand.parseAsync(['node', 'init', '--yes'], { from: 'node' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('backed up to'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Config created at'))
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('generates loop defaults with the expanded stage list and implementation bindings', async () => {
    const { generateConfig } = await vi.importActual<typeof import('../../src/platform/config/init.js')>(
      '../../src/platform/config/init.js'
    )

    const content = generateConfig(['codex', 'gemini-cli', 'kiro'])

    expect(content).toContain('stages: [prd_review, domain_partition, trd_generation, milestone_planning, dev_preparation, red_test_confirmation, implementation, green_fixup, unit_mock_test, integration_test]')
    expect(content).toContain('stage_bindings:')
    expect(content).toContain('implementation:')
    expect(content).toContain('primary:')
    expect(content).toContain('tool: codex')
    expect(content).toContain('reviewer:')
    expect(content).toContain('model: gemini-cli')
    expect(content).toContain('rescue:')
    expect(content).toContain('tool: kiro')
  })

  it('generates profile-specific defaults for background hosting', async () => {
    const { generateConfig } = await vi.importActual<typeof import('../../src/platform/config/init.js')>(
      '../../src/platform/config/init.js'
    )

    const content = generateConfig(['codex', 'gemini-cli'], { profile: 'background' })

    expect(content).toContain('onboarding_profile: background')
    expect(content).toContain('resource_guard:')
    expect(content).toContain('enabled: true')
    expect(content).toContain('tool_loading:')
    expect(content).toContain('skills:')
  })

  it('upgrades config via --upgrade with dry-run and custom path', async () => {
    const upgradeConfigWithResult = vi.fn(() => ({
      configPath: '/tmp/custom.yaml',
      written: false,
      changes: ['Added capabilities.routing defaults.'],
      warnings: ['Review repo-specific verification commands before applying this config to a non-Node repository.'],
      content: 'capabilities:\n  routing:\n    enabled: true\n',
    }))

    vi.doMock('../../src/platform/config/init.js', () => ({
      AVAILABLE_REVIEWERS: [],
      initConfigWithResult: vi.fn(),
      upgradeConfigWithResult,
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { initCommand } = await import('../../src/cli/commands/init.js')

    await initCommand.parseAsync(['node', 'init', '--upgrade', '--dry-run', '--config', '/tmp/custom.yaml'], { from: 'node' })

    expect(upgradeConfigWithResult).toHaveBeenCalledWith('/tmp/custom.yaml', { dryRun: true })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Added capabilities.routing defaults.'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Review repo-specific verification commands'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('capabilities:'))
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('prints an error and exits when init fails', async () => {
    vi.doMock('../../src/platform/config/init.js', () => ({
      AVAILABLE_REVIEWERS: [],
      initConfigWithResult: vi.fn(() => {
        throw new Error('boom')
      }),
    }))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`)
    })
    const { initCommand } = await import('../../src/cli/commands/init.js')

    await expect(initCommand.parseAsync(['node', 'init', '--yes'], { from: 'node' })).rejects.toThrow('exit:1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: boom'))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('prints next steps with doctor command after init', async () => {
    const log = vi.fn()
    const { printInitNextSteps } = await import('../../src/cli/commands/init.js')

    printInitNextSteps('/tmp/custom-config.yaml', { log })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Next steps'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('magpie doctor --config /tmp/custom-config.yaml'))
  })
})

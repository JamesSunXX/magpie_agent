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
      'https://jira.example.com',
      'ENG',
      'jira@example.com',
      'jira-token',
    ]))

    expect(result).toEqual({
      enabled: true,
      defaultProvider: 'jira_main',
      jiraBaseUrl: 'https://jira.example.com',
      jiraProjectKey: 'ENG',
      jiraEmail: 'jira@example.com',
      jiraApiToken: 'jira-token',
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
})

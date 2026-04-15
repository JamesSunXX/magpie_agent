import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'

const execFileSyncMock = vi.hoisted(() => vi.fn())
const knowledgeMocks = vi.hoisted(() => ({
  failPromote: false,
}))
const stageAiProviderMocks = vi.hoisted(() => ({
  factory: null as null | (() => {
    name?: string
    setCwd?: ReturnType<typeof vi.fn>
    chat: ReturnType<typeof vi.fn>
    chatStream?: ReturnType<typeof vi.fn>
  }),
}))
const validatorProviderMocks = vi.hoisted(() => ({
  claw: vi.fn(async () => '```json\n{"decision":"approved","rationale":"claw ok","unresolvedItems":[]}\n```'),
  kiro: vi.fn(async () => '```json\n{"decision":"approved","rationale":"kiro ok","unresolvedItems":[]}\n```'),
  codex: vi.fn(async () => '```json\n{"decision":"approved","rationale":"codex ok","unresolvedItems":[]}\n```'),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  }
})

vi.mock('../../../src/knowledge/runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/runtime.js')>()
  return {
    ...actual,
    promoteKnowledgeCandidates: vi.fn(async (...args: Parameters<typeof actual.promoteKnowledgeCandidates>) => {
      if (knowledgeMocks.failPromote) {
        throw new Error('knowledge promotion failed')
      }
      return actual.promoteKnowledgeCandidates(...args)
    }),
  }
})

import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { runCapability } from '../../../src/core/capability/runner.js'
import { executeHarness } from '../../../src/capabilities/workflows/harness/application/execute.js'
import { prepareHarnessInput } from '../../../src/capabilities/workflows/harness/application/prepare.js'
import { reportHarness } from '../../../src/capabilities/workflows/harness/application/report.js'
import { readFailureIndex } from '../../../src/core/failures/ledger.js'

const originalHarnessEnv = {
  executionHost: process.env.MAGPIE_EXECUTION_HOST,
  tmuxSession: process.env.MAGPIE_TMUX_SESSION,
  tmuxWindow: process.env.MAGPIE_TMUX_WINDOW,
  tmuxPane: process.env.MAGPIE_TMUX_PANE,
}

vi.mock('../../../src/core/capability/runner.js', () => ({
  runCapability: vi.fn(),
}))

vi.mock('../../../src/platform/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/platform/providers/index.js')>()
  return {
    ...actual,
    createConfiguredProvider: vi.fn((input: { tool?: string; model?: string }) => {
      const providerKey = input.tool === 'claw'
        ? 'claw'
        : input.tool === 'codex'
          ? 'codex'
          : input.tool === 'kiro'
            ? 'kiro'
            : input.model === 'codex'
              ? 'codex'
              : input.model === 'kiro'
                ? 'kiro'
                : 'kiro'
      return {
        setCwd: vi.fn(),
        chat: validatorProviderMocks[providerKey as 'claw' | 'kiro' | 'codex'],
      }
    }),
  }
})

vi.mock('../../../src/providers/configured-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/providers/configured-provider.js')>()
  return {
    ...actual,
    createConfiguredProvider: vi.fn((input, config) => {
      if (stageAiProviderMocks.factory && input.logicalName === 'integrations.notifications.stage_ai') {
        return stageAiProviderMocks.factory()
      }
      return actual.createConfiguredProvider(input, config)
    }),
  }
})

interface ConfigOptions {
  loopPlannerModel?: string
  loopExecutorModel?: string
  issueFixPlannerModel?: string
  issueFixExecutorModel?: string
  routingEnabled?: boolean
  geminiEnabled?: boolean
  kiroEnabled?: boolean
}

function writeConfig(configPath: string, options: ConfigOptions = {}): void {
  writeFileSync(configPath, `providers:
  claude-code:
    enabled: true
  gemini-cli:
    enabled: ${options.geminiEnabled === false ? 'false' : 'true'}
  kiro:
    enabled: ${options.kiroEnabled === false ? 'false' : 'true'}
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  baseline:
    model: mock
    prompt: baseline review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  loop:
    enabled: true
    planner_model: ${options.loopPlannerModel || 'mock'}
    executor_model: ${options.loopExecutorModel || 'mock'}
  issue_fix:
    enabled: true
    planner_model: ${options.issueFixPlannerModel || 'mock'}
    executor_model: ${options.issueFixExecutorModel || 'mock'}
  routing:
    enabled: ${options.routingEnabled ? 'true' : 'false'}
  quality:
    unitTestEval:
      enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')
}

function mockClaudeHealthy(): void {
  execFileSyncMock.mockImplementation((file: string, args?: string[]) => {
    if (file === 'claude' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'status') {
      return JSON.stringify({
        loggedIn: true,
        subscriptionType: 'pro',
        authMethod: 'claude.ai',
      })
    }
    if (file === 'claude') {
      return 'MAGPIE_CLAUDE_OK'
    }
    if (file === 'kiro-cli') {
      return 'kiro ok'
    }
    throw new Error(`Unexpected command: ${file} ${Array.isArray(args) ? args.join(' ') : ''}`)
  })
}

function mockClaudeAuthFailure(): void {
  execFileSyncMock.mockImplementation((file: string, args?: string[]) => {
    if (file === 'claude' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'status') {
      return JSON.stringify({
        loggedIn: false,
        subscriptionType: 'pro',
      })
    }
    if (file === 'kiro-cli') {
      return 'kiro ok'
    }
    throw new Error(`Unexpected command: ${file} ${Array.isArray(args) ? args.join(' ') : ''}`)
  })
}

function mockClaudeProbeFailure(): void {
  execFileSyncMock.mockImplementation((file: string, args?: string[]) => {
    if (file === 'claude' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'status') {
      return JSON.stringify({
        loggedIn: true,
        subscriptionType: 'pro',
      })
    }
    if (file === 'claude') {
      throw new Error('429 rate limit exceeded for current subscription')
    }
    if (file === 'kiro-cli') {
      return 'kiro ok'
    }
    throw new Error(`Unexpected command: ${file} ${Array.isArray(args) ? args.join(' ') : ''}`)
  })
}

function mockClaudeProbeTimeout(): void {
  execFileSyncMock.mockImplementation((file: string, args?: string[]) => {
    if (file === 'claude' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'status') {
      return JSON.stringify({
        loggedIn: true,
        subscriptionType: 'pro',
      })
    }
    if (file === 'claude') {
      throw new Error('spawnSync claude ETIMEDOUT')
    }
    if (file === 'kiro-cli') {
      return 'kiro ok'
    }
    throw new Error(`Unexpected command: ${file} ${Array.isArray(args) ? args.join(' ') : ''}`)
  })
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('harness workflow', () => {
  afterEach(() => {
    if (originalHarnessEnv.executionHost === undefined) {
      delete process.env.MAGPIE_EXECUTION_HOST
    } else {
      process.env.MAGPIE_EXECUTION_HOST = originalHarnessEnv.executionHost
    }
    if (originalHarnessEnv.tmuxSession === undefined) {
      delete process.env.MAGPIE_TMUX_SESSION
    } else {
      process.env.MAGPIE_TMUX_SESSION = originalHarnessEnv.tmuxSession
    }
    if (originalHarnessEnv.tmuxWindow === undefined) {
      delete process.env.MAGPIE_TMUX_WINDOW
    } else {
      process.env.MAGPIE_TMUX_WINDOW = originalHarnessEnv.tmuxWindow
    }
    if (originalHarnessEnv.tmuxPane === undefined) {
      delete process.env.MAGPIE_TMUX_PANE
    } else {
      process.env.MAGPIE_TMUX_PANE = originalHarnessEnv.tmuxPane
    }
    vi.clearAllMocks()
    knowledgeMocks.failPromote = false
    stageAiProviderMocks.factory = null
    validatorProviderMocks.claw.mockClear()
    validatorProviderMocks.kiro.mockClear()
    validatorProviderMocks.codex.mockClear()
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('dispatches stage-aware notifications for harness outer stages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-stage-notify-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })

    const configContent = readFileSync(configPath, 'utf-8').replace(
      'integrations:\n  notifications:\n    enabled: false\n',
      `integrations:\n  notifications:\n    enabled: true\n    stage_ai:\n      enabled: true\n      provider: mock\n      max_summary_chars: 900\n      include_loop: true\n      include_harness: true\n    routes:\n      stage_entered: [feishu_team]\n      stage_completed: [feishu_team]\n    providers:\n      feishu_team:\n        type: feishu-webhook\n        webhook_url: https://example.com/hook\n`
    )
    writeFileSync(configPath, configContent, 'utf-8')

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockClaudeAuthFailure()
    process.env.MAGPIE_MOCK_RESPONSE = 'not-json'

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-1' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      const events = readFileSync(result.session!.artifacts.eventsPath, 'utf-8')
      expect(events).toContain('"type":"stage_changed"')
      expect(events).toContain('"type":"stage_entered","stage":"queued"')
      expect(events).toContain('"type":"stage_entered","stage":"developing"')
      expect(fetchMock).toHaveBeenCalled()
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      const firstText = firstBody.content.post.zh_cn.content[0][0].text as string
      expect(firstBody.content.post.zh_cn.title).toContain('[stage_entered]')
      expect(firstText).toContain('AI: kiro / kiro')
      expect(firstText).not.toContain('claude-code')
    } finally {
      delete process.env.MAGPIE_MOCK_RESPONSE
    }
  })

  it('falls back from hanging stage AI summaries without blocking harness progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-stage-ai-timeout-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    const configContent = readFileSync(configPath, 'utf-8').replace(
      'integrations:\n  notifications:\n    enabled: false\n',
      `integrations:\n  notifications:\n    enabled: true\n    stage_ai:\n      enabled: true\n      provider: codex\n      timeout_ms: 25\n      max_summary_chars: 900\n      include_loop: true\n      include_harness: true\n    routes:\n      stage_entered: [feishu_team]\n      stage_completed: [feishu_team]\n    providers:\n      feishu_team:\n        type: feishu-webhook\n        webhook_url: https://example.com/hook\n`
    )
    writeFileSync(configPath, configContent, 'utf-8')

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockClaudeHealthy()

    const hangingChat = vi.fn(() => new Promise<string>(() => {}))
    stageAiProviderMocks.factory = () => ({
      name: 'stage-ai-hang',
      setCwd: vi.fn(),
      chat: hangingChat,
      chatStream: vi.fn(async function * () {}),
    })

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-1' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)

      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(hangingChat).toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalled()
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      const firstText = firstBody.content.post.zh_cn.content[0][0].text as string
      expect(firstBody.content.post.zh_cn.title).toContain('[stage_entered]')
      expect(firstText).toContain('阶段: queued')
      expect(firstText).toContain('下一步: 选择本轮可用模型并进入开发阶段。')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('runs claw and kiro validation checks and persists their artifacts per cycle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-validators-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-validators' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'Deliver checkout v2',
      prdPath: join(dir, 'docs', 'prd.md'),
    }, ctx)

    const result = await executeHarness(prepared, ctx)
    const cycleDir = join(result.session!.artifacts.roundsPath, '..', 'cycle-1')

    expect(validatorProviderMocks.claw).toHaveBeenCalled()
    expect(validatorProviderMocks.kiro).toHaveBeenCalled()
    expect(readFileSync(join(cycleDir, 'validator-1-claw.json'), 'utf-8')).toContain('claw ok')
    expect(readFileSync(join(cycleDir, 'validator-2-kiro.json'), 'utf-8')).toContain('kiro ok')
  })

  it('keeps the harness moving when claw is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-validator-fallback-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    validatorProviderMocks.claw.mockRejectedValueOnce(new Error('spawn claw ENOENT'))

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-validators' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'Deliver checkout v2',
      prdPath: join(dir, 'docs', 'prd.md'),
    }, ctx)

    const result = await executeHarness(prepared, ctx)
    const cycleDir = join(result.session!.artifacts.roundsPath, '..', 'cycle-1')

    expect(result.status).toBe('completed')
    expect(readFileSync(join(cycleDir, 'validator-1-claw.json'), 'utf-8')).toContain('spawn claw ENOENT')
    expect(readFileSync(join(cycleDir, 'validator-2-kiro.json'), 'utf-8')).toContain('kiro ok')
  })

  it('uses configured harness reviewers and validator checks before falling back to built-ins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-configured-reviewers-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:
  codex:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  alpha:
    tool: codex
    prompt: alpha review
  beta:
    tool: codex
    prompt: beta review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  harness:
    default_reviewers: [alpha, beta]
    validator_checks:
      - tool: codex
  loop:
    enabled: true
    planner_model: mock
    executor_model: mock
  issue_fix:
    enabled: true
    planner_model: mock
    executor_model: mock
  routing:
    enabled: false
  quality:
    unitTestEval:
      enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const reviewCalls: Array<{ reviewers: string }> = []
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-configured' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        reviewCalls.push({ reviewers: (input as { options: { reviewers: string } }).options.reviewers })
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'Deliver checkout v2',
      prdPath: join(dir, 'docs', 'prd.md'),
    }, ctx)

    const result = await executeHarness(prepared, ctx)
    const cycleDir = join(result.session!.artifacts.roundsPath, '..', 'cycle-1')
    const harnessConfig = YAML.parse(readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')) as {
      reviewers: Record<string, { prompt?: string }>
      capabilities: {
        issue_fix?: {
          planner_model?: string
          executor_model?: string
        }
      }
    }

    expect(result.status).toBe('completed')
    expect(reviewCalls[0]?.reviewers).toBe('alpha,beta')
    expect(validatorProviderMocks.codex).toHaveBeenCalled()
    expect(validatorProviderMocks.claw).not.toHaveBeenCalled()
    expect(validatorProviderMocks.kiro).toHaveBeenCalledTimes(1)
    expect(harnessConfig.reviewers.alpha?.prompt).toBe('alpha review')
    expect(harnessConfig.reviewers.beta?.prompt).toBe('beta review')
    expect(harnessConfig.capabilities.issue_fix?.planner_model).toBe('mock')
    expect(harnessConfig.capabilities.issue_fix?.executor_model).toBe('mock')
    expect(readFileSync(join(cycleDir, 'validator-1-codex.json'), 'utf-8')).toContain('codex ok')
  })

  it('resumes review from persisted cycles without rerunning completed development', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-resume-review-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)

    const sessionId = 'harness-resume-review'
    const sessionDir = join(dir, '.magpie', 'sessions', 'harness', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    const roundsPath = join(sessionDir, 'rounds.json')
    writeFileSync(roundsPath, JSON.stringify([{
      cycle: 1,
      reviewOutputPath: join(sessionDir, 'cycle-1', 'review.json'),
      validatorChecks: [
        { id: '1-claw', label: 'claw', tool: 'claw', outputPath: join(sessionDir, 'cycle-1', 'validator-1-claw.json') },
        { id: '2-kiro', label: 'kiro', tool: 'kiro', outputPath: join(sessionDir, 'cycle-1', 'validator-2-kiro.json') },
      ],
      adjudicationOutputPath: join(sessionDir, 'cycle-1', 'adjudication.json'),
      unitTestEvalPath: join(sessionDir, 'cycle-1', 'unit-test-eval.json'),
      issueCount: 1,
      blockingIssueCount: 1,
      testsPassed: false,
      modelDecision: 'revise',
      modelRationale: 'Need another fix',
      issueFixSessionId: 'issue-fix-1',
    }], null, 2), 'utf-8')
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      id: sessionId,
      capability: 'harness',
      title: 'Deliver checkout v2',
      createdAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:05:00.000Z').toISOString(),
      status: 'waiting_next_cycle',
      currentStage: 'reviewing',
      summary: 'Cycle 1 requested more changes.',
      artifacts: {
        repoRootPath: dir,
        roundsPath,
        harnessConfigPath: join(sessionDir, 'harness.config.yaml'),
        providerSelectionPath: join(sessionDir, 'provider-selection.json'),
        routingDecisionPath: join(sessionDir, 'routing-decision.json'),
        eventsPath: join(sessionDir, 'events.jsonl'),
        loopSessionId: 'loop-existing',
      },
    }, null, 2), 'utf-8')

    const previousSessionId = process.env.MAGPIE_SESSION_ID
    process.env.MAGPIE_SESSION_ID = sessionId

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        throw new Error('loop should not rerun when development already completed')
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        expect(reviewOutput).toContain('cycle-2')
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)
      const rounds = readJson<Array<{ cycle: number }>>(roundsPath)

      expect(result.status).toBe('completed')
      expect(rounds).toHaveLength(2)
      expect(rounds[0]?.cycle).toBe(1)
      expect(rounds[1]?.cycle).toBe(2)
      expect(runCapabilityMock.mock.calls.filter(([module]) => module.name === 'loop')).toHaveLength(0)
    } finally {
      if (previousSessionId === undefined) {
        delete process.env.MAGPIE_SESSION_ID
      } else {
        process.env.MAGPIE_SESSION_ID = previousSessionId
      }
    }
  })

  it('resumes the loop stage when development was interrupted mid-run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-resume-loop-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)

    const sessionId = 'harness-resume-loop'
    const sessionDir = join(dir, '.magpie', 'sessions', 'harness', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      id: sessionId,
      capability: 'harness',
      title: 'Deliver checkout v2',
      createdAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:05:00.000Z').toISOString(),
      status: 'waiting_next_cycle',
      currentStage: 'developing',
      summary: 'Loop development was interrupted.',
      artifacts: {
        repoRootPath: dir,
        roundsPath: join(sessionDir, 'rounds.json'),
        harnessConfigPath: join(sessionDir, 'harness.config.yaml'),
        providerSelectionPath: join(sessionDir, 'provider-selection.json'),
        routingDecisionPath: join(sessionDir, 'routing-decision.json'),
        eventsPath: join(sessionDir, 'events.jsonl'),
        loopSessionId: 'loop-resume-1',
      },
    }, null, 2), 'utf-8')

    const previousSessionId = process.env.MAGPIE_SESSION_ID
    process.env.MAGPIE_SESSION_ID = sessionId

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        expect(input).toMatchObject({
          mode: 'resume',
          sessionId: 'loop-resume-1',
        })
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-resume-1' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(runCapabilityMock.mock.calls.find(([module]) => module.name === 'loop')?.[1]).toMatchObject({
        mode: 'resume',
        sessionId: 'loop-resume-1',
      })
    } finally {
      if (previousSessionId === undefined) {
        delete process.env.MAGPIE_SESSION_ID
      } else {
        process.env.MAGPIE_SESSION_ID = previousSessionId
      }
    }
  })

  it('marks developing stage as failed when loop development fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-stage-failed-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    const configContent = readFileSync(configPath, 'utf-8').replace(
      'integrations:\n  notifications:\n    enabled: false\n',
      `integrations:\n  notifications:\n    enabled: true\n    stage_ai:\n      enabled: true\n      provider: mock\n      max_summary_chars: 900\n      include_loop: true\n      include_harness: true\n    routes:\n      stage_entered: [feishu_team]\n      stage_completed: [feishu_team]\n      stage_failed: [feishu_team]\n    providers:\n      feishu_team:\n        type: feishu-webhook\n        webhook_url: https://example.com/hook\n`
    )
    writeFileSync(configPath, configContent, 'utf-8')

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'failed', session: { id: 'loop-1' } },
          output: {} as never,
        }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      const events = readFileSync(result.session!.artifacts.eventsPath, 'utf-8')
      expect(events).toContain('"type":"stage_failed","stage":"developing","summary":"Harness failed during loop development stage."')
      expect(events).not.toContain('"type":"stage_completed","stage":"developing"')
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('pauses developing stage when loop development pauses for human review', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-stage-paused-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    const configContent = readFileSync(configPath, 'utf-8').replace(
      'integrations:\n  notifications:\n    enabled: false\n',
      `integrations:\n  notifications:\n    enabled: true\n    stage_ai:\n      enabled: true\n      provider: mock\n      max_summary_chars: 900\n      include_loop: true\n      include_harness: true\n    routes:\n      stage_entered: [feishu_team]\n      stage_completed: [feishu_team]\n      stage_paused: [feishu_team]\n    providers:\n      feishu_team:\n        type: feishu-webhook\n        webhook_url: https://example.com/hook\n`
    )
    writeFileSync(configPath, configContent, 'utf-8')

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'paused', session: { id: 'loop-paused-1' } },
          output: {} as never,
        }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('blocked')
      expect(result.session?.status).toBe('blocked')
      expect(result.session?.currentStage).toBe('developing')
      const failureLogDir = result.session?.artifacts.failureLogDir
      if (failureLogDir && existsSync(failureLogDir)) {
        expect(readdirSync(failureLogDir)).toHaveLength(0)
      }
      const events = readFileSync(result.session!.artifacts.eventsPath, 'utf-8')
      expect(events).toContain('"type":"stage_paused","stage":"developing","summary":"Harness paused during loop development stage for human intervention."')
      expect(events).not.toContain('"type":"stage_completed","stage":"developing"')
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('forwards nested loop progress and persists loop event artifacts early', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-loop-progress-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)

    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, _input, ctx) => {
      if (module.name === 'loop') {
        const observer = ctx.metadata?.loopProgress as {
          onSessionUpdate?: (session: Record<string, unknown>) => void
          onEvent?: (event: Record<string, unknown>) => void
        }
        observer.onSessionUpdate?.({
          id: 'loop-live',
          artifacts: {
            eventsPath: '/tmp/loop-live-events.jsonl',
            workspaceMode: 'current',
            workspacePath: dir,
          },
        })
        observer.onEvent?.({
          ts: '2026-04-11T00:00:01.000Z',
          event: 'provider_progress',
          stage: 'code_development',
          provider: 'codex',
          progressType: 'turn.started',
          summary: 'Codex turn started.',
        })
        return {
          prepared: {} as never,
          result: {
            status: 'completed',
            session: {
              id: 'loop-live',
              artifacts: {
                eventsPath: '/tmp/loop-live-events.jsonl',
                workspaceMode: 'current',
                workspacePath: dir,
              },
            },
          },
          output: { summary: 'loop ok' } as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (_input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (_input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    const onSessionUpdate = vi.fn()
    const onEvent = vi.fn()
    const ctx = createCapabilityContext({
      cwd: dir,
      configPath,
      metadata: {
        harnessProgress: {
          onSessionUpdate,
          onEvent,
        },
      },
    })
    const prepared = await prepareHarnessInput({
      goal: 'Deliver checkout v2',
      prdPath: join(dir, 'docs', 'prd.md'),
    }, ctx)

    const result = await executeHarness(prepared, ctx)

    expect(result.session?.artifacts.loopSessionId).toBe('loop-live')
    expect(result.session?.artifacts.loopEventsPath).toBe('/tmp/loop-live-events.jsonl')
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'provider_progress',
      summary: 'Codex turn started.',
      provider: 'codex',
      progressType: 'turn.started',
    }))
  })

  it('completes when adversarial models approve and tests pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-ok-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    delete process.env.MAGPIE_EXECUTION_HOST
    delete process.env.MAGPIE_TMUX_SESSION
    delete process.env.MAGPIE_TMUX_WINDOW
    delete process.env.MAGPIE_TMUX_PANE

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-1' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(result.session?.status).toBe('completed')
      expect(result.session?.artifacts.loopSessionId).toBe('loop-1')
      expect((result.session?.evidence as { runtime?: { processId?: number } } | undefined)?.runtime?.processId).toBe(process.pid)
      expect(result.session?.artifacts.providerSelectionPath).toBeTruthy()
      expect(result.session?.artifacts.eventsPath).toBeTruthy()
      expect(result.session?.artifacts.knowledgeSchemaPath).toBeTruthy()
      expect(result.session?.artifacts.knowledgeStatePath).toBeTruthy()
      expect(result.session?.artifacts.knowledgeSummaryDir).toBeTruthy()
      expect(result.session?.currentStage).toBe('completed')
      expect(readFileSync(result.session!.artifacts.knowledgeSchemaPath, 'utf-8')).toContain('Task Knowledge Schema')
      expect(readFileSync(result.session!.artifacts.knowledgeStatePath!, 'utf-8')).toContain('"currentStage": "completed"')
      expect(readFileSync(join(result.session!.artifacts.knowledgeSummaryDir, 'final.md'), 'utf-8')).toContain('Harness approved after 1 cycle(s).')
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('planner_model: claude-code')
      expect(harnessConfig).toContain('executor_model: claude-code')
      const events = readFileSync(result.session!.artifacts.eventsPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; stage?: string })
      expect(events.some((event) => event.type === 'workflow_started')).toBe(true)
      expect(events.some((event) => event.type === 'stage_changed' && event.stage === 'developing')).toBe(true)
      expect(events.some((event) => event.type === 'cycle_completed')).toBe(true)
      expect(events.at(-1)?.type).toBe('workflow_completed')
      const selection = readJson<{
        decision: string
        hasPreciseUsage: boolean
        replacements: string[]
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('keep_claude')
      expect(selection.hasPreciseUsage).toBe(false)
      expect(selection.replacements).toEqual([])
      const repoKnowledgeDir = join(magpieHome, 'knowledge')
      expect(readFileSync(join(repoKnowledgeDir, readdirSync(repoKnowledgeDir)[0], 'index.md'), 'utf-8')).toContain('Deliver checkout v2')
      const calledNames = runCapabilityMock.mock.calls.map(([module]) => module.name)
      expect(calledNames).not.toContain('issue-fix')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('persists a completed harness session even if knowledge promotion fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-knowledge-fail-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    knowledgeMocks.failPromote = true

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-1' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'Deliver checkout v2',
      prdPath: join(dir, 'docs', 'prd.md'),
    }, ctx)
    const result = await executeHarness(prepared, ctx)

    expect(result.status).toBe('completed')
    expect(result.session?.status).toBe('completed')
  })

  it('persists loop workspace metadata onto the harness session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-workspace-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: {
            status: 'completed',
            session: {
              id: 'loop-worktree',
              artifacts: {
                workspaceMode: 'worktree',
                workspacePath: '/tmp/worktrees/sch/run-1',
                worktreeBranch: 'sch/run-1',
              },
            },
          },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(result.session?.artifacts.loopSessionId).toBe('loop-worktree')
      expect(result.session?.artifacts.workspaceMode).toBe('worktree')
      expect(result.session?.artifacts.workspacePath).toBe('/tmp/worktrees/sch/run-1')
      expect(result.session?.artifacts.worktreeBranch).toBe('sch/run-1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('forwards host and complexity overrides into the nested loop run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-loop-input-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    let capturedLoopInput: Record<string, unknown> | undefined
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        capturedLoopInput = input as Record<string, unknown>
        return {
          prepared: {} as never,
          result: {
            status: 'completed',
            session: {
              id: 'loop-override',
              artifacts: {},
            },
          },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        complexity: 'complex',
        host: 'tmux',
      }, ctx)

      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(capturedLoopInput).toEqual(expect.objectContaining({
        mode: 'run',
        goal: 'Deliver checkout v2',
        complexity: 'complex',
        host: 'tmux',
      }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('fails after max cycles when model keeps requesting revisions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-fail-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    let issueFixCalls = 0
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-2' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({
          parsedIssues: [{
            severity: 'high',
            category: 'logic',
            file: 'src/core.ts',
            title: 'Blocking issue',
            description: 'Must fix before release',
            raisedBy: ['harness-1'],
            descriptions: ['Must fix before release'],
          }],
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"revise","rationale":"still risky","requiredActions":["fix blocking issue"]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'issue-fix') {
        issueFixCalls += 1
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: `issue-fix-${issueFixCalls}` } },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        maxCycles: 2,
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      expect(result.session?.status).toBe('failed')
      expect(result.session?.currentStage).toBe('failed')
      expect(issueFixCalls).toBe(2)
      const failureFiles = readdirSync(result.session!.artifacts.failureLogDir!)
      const failure = JSON.parse(readFileSync(join(result.session!.artifacts.failureLogDir!, failureFiles[0]!), 'utf-8')) as {
        category: string
        metadata: Record<string, unknown>
      }
      expect(failure.category).toBe('quality')
      expect(failure.metadata.finalApprovalDenied).toBe(true)
      const events = readFileSync(result.session!.artifacts.eventsPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; cycle?: number })
      expect(events.filter((event) => event.type === 'cycle_completed')).toHaveLength(2)
      expect(events.at(-1)?.type).toBe('workflow_failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('records a revise decision even when adjudication fallbacks include unrelated JSON snippets first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-noisy-adjudication-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-noisy' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({
          parsedIssues: [{
            severity: 'high',
            category: 'logic',
            file: 'src/core.ts',
            title: 'Blocking issue',
            description: 'Must fix before release',
            raisedBy: ['harness-1'],
            descriptions: ['Must fix before release'],
          }],
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '## 讨论总结\n\n请参考附加材料。',
          analysis: 'Reading file completed.\n[1.1]',
          messages: [
            { content: '```json\n[1.1]\n```' },
            { content: '```json\n{"decision":"revise","rationale":"Need a real staged-content verification.","requiredActions":["Verify staged content instead of the working tree."]}\n```' },
          ],
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'issue-fix') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'issue-fix-noisy' } },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        maxCycles: 1,
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      const rounds = JSON.parse(readFileSync(result.session!.artifacts.roundsPath, 'utf-8')) as Array<{
        modelDecision: string
        modelRationale: string
        nextRoundBrief: string
      }>
      expect(rounds[0]).toMatchObject({
        modelDecision: 'revise',
        modelRationale: 'Need a real staged-content verification.',
        nextRoundBrief: 'Verify staged content instead of the working tree.',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('falls back to kiro when claude auth is not usable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-auth-fallback-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })
    mockClaudeAuthFailure()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-auth-fallback' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        models: ['claude-code', 'gemini-cli'],
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('model: kiro')
      expect(harnessConfig).toContain('planner_model: kiro')
      expect(harnessConfig).toContain('executor_model: kiro')
      const selection = readJson<{
        decision: string
        replacements: string[]
        claudeAuth: { loggedIn: boolean }
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('fallback_to_kiro')
      expect(selection.claudeAuth.loggedIn).toBe(false)
      expect(selection.replacements.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('falls back to kiro when claude probe reports usage-style failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-probe-fallback-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'mock',
      issueFixPlannerModel: 'mock',
      issueFixExecutorModel: 'claude-code',
    })
    mockClaudeProbeFailure()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-probe-fallback' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        models: ['gemini-cli', 'kiro'],
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      const selection = readJson<{
        decision: string
        claudeProbe: { ok: boolean; reason: string }
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('fallback_to_kiro')
      expect(selection.claudeProbe.ok).toBe(false)
      expect(selection.claudeProbe.reason).toContain('429')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('keeps claude when the probe only times out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-probe-timeout-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })
    mockClaudeProbeTimeout()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-probe-timeout' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        models: ['claude-code', 'claude-code'],
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      const selection = readJson<{
        decision: string
        replacements: string[]
        claudeProbe: { ok: boolean; reason?: string }
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('keep_claude')
      expect(selection.replacements).toEqual([])
      expect(selection.claudeProbe.ok).toBe(false)
      expect(selection.claudeProbe.reason).toContain('ETIMEDOUT')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('skips claude checks when harness does not use claude anywhere', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-no-claude-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'mock',
      loopExecutorModel: 'codex',
      issueFixPlannerModel: 'mock',
      issueFixExecutorModel: 'codex',
    })

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-no-claude' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        models: ['gemini-cli', 'kiro'],
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(execFileSyncMock).not.toHaveBeenCalled()
      const selection = readJson<{
        decision: string
        replacements: string[]
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('no_claude_in_harness')
      expect(selection.replacements).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('fails when loop returns non-completed status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-loop-fail-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'failed', session: { id: 'loop-fail-1' } },
          output: {} as never,
        }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: {} as never }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      expect(result.session?.summary).toContain('loop')
      expect(result.session?.artifacts.loopSessionId).toBe('loop-fail-1')
      expect(readFileSync(result.session!.artifacts.knowledgeStatePath!, 'utf-8')).toContain('"currentStage": "failed"')
      // review should never have been called
      const calledNames = runCapabilityMock.mock.calls.map(([m]) => m.name)
      expect(calledNames).not.toContain('review')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('persists failed session when cycle throws unexpected error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-cycle-throw-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)
    mockClaudeHealthy()

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-cycle-throw' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        throw new Error('disk full')
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: {} as never }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        maxCycles: 1,
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      expect(result.session?.summary).toContain('disk full')
      expect(result.session?.artifacts.loopSessionId).toBe('loop-cycle-throw')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('fails before loop starts when fallback is required but kiro is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-kiro-missing-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      loopPlannerModel: 'claude-code',
      loopExecutorModel: 'claude-code',
      issueFixPlannerModel: 'claude-code',
      issueFixExecutorModel: 'claude-code',
    })

    execFileSyncMock.mockImplementation((file: string, args?: string[]) => {
      if (file === 'claude' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'status') {
        return JSON.stringify({
          loggedIn: false,
          subscriptionType: 'pro',
        })
      }
      if (file === 'kiro-cli') {
        throw new Error('kiro-cli missing')
      }
      throw new Error(`Unexpected command: ${file} ${Array.isArray(args) ? args.join(' ') : ''}`)
    })

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockResolvedValue({
      prepared: {} as never,
      result: { status: 'completed', session: { id: 'should-not-run' } },
      output: { summary: 'ok' } as never,
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
        models: ['claude-code', 'gemini-cli'],
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('failed')
      expect(result.session?.summary).toContain('Kiro')
      expect(runCapabilityMock).not.toHaveBeenCalled()
      expect(readFileSync(result.session!.artifacts.knowledgeStatePath!, 'utf-8')).toContain('"currentStage": "failed"')
      const selection = readJson<{
        decision: string
        kiroCheck: { ok: boolean; reason: string }
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('fallback_failed')
      expect(selection.kiroCheck.ok).toBe(false)
      expect(selection.kiroCheck.reason).toContain('kiro-cli missing')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('writes routing decisions and auto-selects complex reviewer pool when complexity override is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-routing-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      routingEnabled: true,
      loopPlannerModel: 'mock',
      loopExecutorModel: 'mock',
      issueFixPlannerModel: 'mock',
      issueFixExecutorModel: 'mock',
    })

    const reviewCalls: Array<{ reviewers: string }> = []
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-routing' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        reviewCalls.push({ reviewers: (input as { options: { reviewers: string } }).options.reviewers })
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Add payment migration with database auth compatibility and public API rollback support.',
        prdPath: join(dir, 'docs', 'prd.md'),
        complexity: 'complex',
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(reviewCalls[0]?.reviewers).toBe('route-gemini,route-codex,route-architect')
      expect(result.session?.artifacts.routingDecisionPath).toBeTruthy()
      const routingDecision = readJson<{ tier: string }>(result.session!.artifacts.routingDecisionPath)
      expect(routingDecision.tier).toBe('complex')
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('planner_tool: kiro')
      expect(harnessConfig).toContain('planner_model: kiro')
      expect(harnessConfig).toContain('planner_agent: architect')
      expect(harnessConfig).toContain('executor_tool: kiro')
      expect(harnessConfig).toContain('executor_model: kiro')
      expect(harnessConfig).toContain('executor_agent: dev')
      expect(harnessConfig).toContain('strict release gate reviewer')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('falls back to kiro inside review cycle when gemini reviewer hits a known model error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-review-gemini-fallback-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:
  gemini-cli:
    enabled: true
  kiro:
    enabled: true
  codex:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  route-gemini:
    tool: gemini
    prompt: fast path review
  route-codex:
    tool: codex
    prompt: strict review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  loop:
    enabled: true
    planner_model: mock
    executor_model: mock
  issue_fix:
    enabled: true
    planner_model: mock
    executor_model: mock
  harness:
    default_reviewers:
      - route-gemini
      - route-codex
  quality:
    unitTestEval:
      enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const reviewCalls: string[] = []
    const discussCalls: string[] = []
    let reviewAttempt = 0
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-review-fallback' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        reviewAttempt += 1
        const reviewers = (input as { options: { reviewers: string } }).options.reviewers
        reviewCalls.push(reviewers)
        if (reviewAttempt === 1) {
          throw new Error('Gemini CLI exited with code 1: Error when talking to Gemini API ModelNotFoundError: Requested entity was not found. code: 404')
        }
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const reviewers = (input as { options: { reviewers: string } }).options.reviewers
        discussCalls.push(reviewers)
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'issue-fix') {
        throw new Error('issue-fix should not run when fallback review succeeds')
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Recover review cycle when gemini reviewer is unavailable.',
        prdPath: join(dir, 'docs', 'prd.md'),
        maxCycles: 1,
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(reviewCalls).toHaveLength(2)
      expect(reviewCalls[0]).toBe('route-gemini,route-codex')
      expect(reviewCalls[1]).not.toBe(reviewCalls[0])
      expect(reviewCalls[1]).toContain('kiro')
      expect(discussCalls[0]).toBe(reviewCalls[1])
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('route-gemini-fallback-kiro')
      expect(harnessConfig).toContain('tool: kiro')
      expect(harnessConfig).toContain('agent: code-reviewer')
      const roleRound = readJson<{
        reviewResults?: Array<{ reviewerRoleId: string }>
      }>(join(result.session!.artifacts.roleRoundsDir!, 'cycle-1.json'))
      expect(roleRound.reviewResults?.map((item) => item.reviewerRoleId)).toContain('route-gemini-fallback-kiro')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })

  it('falls back to available routed models when the preferred complex provider is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-routing-fallback-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath, {
      routingEnabled: true,
      kiroEnabled: false,
    })

    const reviewCalls: Array<{ reviewers: string }> = []
    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-routing-fallback' } },
          output: {} as never,
        }
      }

      if (module.name === 'review') {
        reviewCalls.push({ reviewers: (input as { options: { reviewers: string } }).options.reviewers })
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }

      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return {
          prepared: {} as never,
          result: { status: 'completed' },
          output: { summary: 'ok' },
        }
      }

      return {
        prepared: {} as never,
        result: { status: 'completed' },
        output: { summary: 'ok' },
      }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Add payment migration with database auth compatibility and public API rollback support.',
        prdPath: join(dir, 'docs', 'prd.md'),
        complexity: 'complex',
      }, ctx)
      const result = await executeHarness(prepared, ctx)

      expect(result.status).toBe('completed')
      expect(reviewCalls[0]?.reviewers).toBe('route-gemini,route-codex')
      const routingDecision = readJson<{
        planning: { tool: string }
        execution: { tool: string }
        fallbackTrail: string[]
      }>(result.session!.artifacts.routingDecisionPath)
      expect(routingDecision.planning).toEqual({ tool: 'codex' })
      expect(routingDecision.execution).toEqual({ tool: 'codex' })
      expect(routingDecision.fallbackTrail).toContain('planning_fallback:complex:kiro::architect->codex::')
      expect(routingDecision.fallbackTrail).toContain('execution_fallback:complex:kiro::dev->codex::')
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('planner_tool: codex')
      expect(harnessConfig).toContain('planner_model: codex')
      expect(harnessConfig).toContain('executor_tool: codex')
      expect(harnessConfig).toContain('executor_model: codex')
      expect(harnessConfig).not.toContain('planner_agent: architect')
      expect(harnessConfig).not.toContain('executor_agent: dev')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })
})

describe('reportHarness logging levels', () => {
  it('logs at error level when details.status is failed', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const errorSpy = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})

    await reportHarness({
      summary: 'Harness workflow failed.',
      details: { status: 'failed' } as never,
    }, ctx)

    expect(errorSpy).toHaveBeenCalledWith('[harness]', 'Harness workflow failed.')
    expect(infoSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('logs session ID and artifact paths on failure when details are present', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const errorSpy = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    await reportHarness({
      summary: 'Harness failed during loop development stage.',
      details: {
        id: 'harness-abc',
        status: 'failed',
        artifacts: {
          harnessConfigPath: '/tmp/harness.config.yaml',
          roundsPath: '/tmp/rounds.json',
          providerSelectionPath: '/tmp/provider-selection.json',
        },
      } as never,
    }, ctx)

    expect(errorSpy).toHaveBeenCalledWith('[harness]', 'Harness failed during loop development stage.')
    expect(errorSpy).toHaveBeenCalledWith('[harness]', 'Session: harness-abc')
    expect(errorSpy).toHaveBeenCalledWith('[harness]', expect.stringContaining('/tmp/harness.config.yaml'))
    expect(errorSpy).toHaveBeenCalledWith('[harness]', expect.stringContaining('/tmp/rounds.json'))
    expect(errorSpy).toHaveBeenCalledWith('[harness]', expect.stringContaining('/tmp/provider-selection.json'))
    errorSpy.mockRestore()
  })

  it('logs at info level when details.status is completed', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const errorSpy = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})

    await reportHarness({
      summary: 'Harness approved after 1 cycle(s).',
      details: { status: 'completed' } as never,
    }, ctx)

    expect(infoSpy).toHaveBeenCalledWith('[harness]', 'Harness approved after 1 cycle(s).')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('logs at info level when details.status is blocked', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const errorSpy = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})

    await reportHarness({
      summary: 'Harness paused during loop development stage for human intervention.',
      details: { status: 'blocked' } as never,
    }, ctx)

    expect(infoSpy).toHaveBeenCalledWith('[harness]', 'Harness paused during loop development stage for human intervention.')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('logs at info level when details is undefined and summary is not failure', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const infoSpy = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})

    await reportHarness({ summary: 'Harness workflow completed.' }, ctx)

    expect(infoSpy).toHaveBeenCalledWith('[harness]', 'Harness workflow completed.')
    infoSpy.mockRestore()
  })

  it('logs at error level when details is undefined but summary indicates failure', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const errorSpy = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})

    await reportHarness({ summary: 'Harness workflow failed.' }, ctx)

    expect(errorSpy).toHaveBeenCalledWith('[harness]', 'Harness workflow failed.')
    expect(infoSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('writes a harness failure record when the inner loop fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-loop-failure-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeConfig(configPath)

    const loopFailurePath = join(dir, 'loop-failure.json')
    writeFileSync(loopFailurePath, JSON.stringify({
      signature: 'loop|code_development|workflow_defect|resume-checkpoint',
      reason: 'Cannot safely resume because no reliable checkpoint was recorded.',
    }, null, 2), 'utf-8')
    mkdirSync(join(dir, '.magpie'), { recursive: true })
    writeFileSync(join(dir, '.magpie', 'failure-index.json'), JSON.stringify({
      version: 1,
      updatedAt: '2026-04-12T10:00:00.000Z',
      entries: [{
        signature: 'loop|code_development|workflow_defect|resume-checkpoint',
        category: 'workflow_defect',
        categories: ['workflow_defect'],
        count: 1,
        firstSeenAt: '2026-04-12T10:00:00.000Z',
        lastSeenAt: '2026-04-12T10:00:00.000Z',
        lastSessionId: 'loop-failed',
        recentSessionIds: ['loop-failed'],
        capabilities: { loop: 1 },
        latestReason: 'Cannot safely resume because no reliable checkpoint was recorded.',
        latestEvidencePaths: [loopFailurePath],
        recentEvidencePaths: [loopFailurePath],
        selfHealCandidateCount: 1,
        candidateForSelfRepair: true,
        lastRecoveryAction: 'spawn_self_repair_candidate',
      }],
    }, null, 2), 'utf-8')

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: {
            status: 'failed',
            session: {
              id: 'loop-failed',
              status: 'failed',
              artifacts: {
                eventsPath: join(dir, 'loop-events.jsonl'),
                lastFailurePath: loopFailurePath,
              },
            },
          },
          output: { summary: 'loop failed' } as never,
        }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'Handle inner loop failure',
      prdPath: join(dir, 'docs', 'prd.md'),
      maxCycles: 1,
    }, ctx)
    const result = await executeHarness(prepared, ctx)

    const failureFiles = readdirSync(result.session!.artifacts.failureLogDir!)
    const failure = JSON.parse(readFileSync(join(result.session!.artifacts.failureLogDir!, failureFiles[0]!), 'utf-8')) as {
      metadata: Record<string, unknown>
    }
    const failureIndex = await readFailureIndex(dir)

    expect(result.status).toBe('failed')
    expect(failure.metadata.sourceFailureSignature).toBe('code_development|workflow_defect|resume-checkpoint')
    expect(failure.metadata.countTowardFailureIndex).toBe(false)
    expect(failureIndex.entries).toHaveLength(1)
    expect(failureIndex.entries[0]).toMatchObject({
      signature: 'code_development|workflow_defect|resume-checkpoint',
      count: 1,
      capabilities: {
        loop: 1,
      },
    })
  })
})

describe('summarizeHarness', () => {
  it('returns session summary when result has a session', async () => {
    const { summarizeHarness } = await import('../../../src/capabilities/workflows/harness/application/summarize.js')
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const result = {
      status: 'failed' as const,
      session: { id: 's1', status: 'failed', summary: 'Harness failed during loop.' } as never,
    }
    const output = await summarizeHarness(result, ctx)
    expect(output.summary).toBe('Harness failed during loop.')
    expect(output.details).toBe(result.session)
  })

  it('returns fallback failure summary when session is undefined', async () => {
    const { summarizeHarness } = await import('../../../src/capabilities/workflows/harness/application/summarize.js')
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const output = await summarizeHarness({ status: 'failed' }, ctx)
    expect(output.summary).toBe('Harness workflow failed.')
    expect(output.details).toBeUndefined()
  })

  it('returns fallback completed summary when session is undefined', async () => {
    const { summarizeHarness } = await import('../../../src/capabilities/workflows/harness/application/summarize.js')
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const output = await summarizeHarness({ status: 'completed' }, ctx)
    expect(output.summary).toBe('Harness workflow completed.')
    expect(output.details).toBeUndefined()
  })

  it('returns fallback paused summary when session is undefined', async () => {
    const { summarizeHarness } = await import('../../../src/capabilities/workflows/harness/application/summarize.js')
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const output = await summarizeHarness({ status: 'blocked' }, ctx)
    expect(output.summary).toBe('Harness workflow paused.')
    expect(output.details).toBeUndefined()
  })
})

describe('prepareHarnessInput', () => {
  it('applies default values when optional fields are omitted', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const prepared = await prepareHarnessInput({ goal: 'ship it', prdPath: '/tmp/prd.md' }, ctx)
    expect(prepared.maxCycles).toBe(3)
    expect(prepared.reviewRounds).toBe(3)
    expect(prepared.models).toEqual(['kiro', 'codex'])
    expect(prepared.preparedAt).toBeInstanceOf(Date)
  })

  it('respects explicit values', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const prepared = await prepareHarnessInput({
      goal: 'ship it',
      prdPath: '/tmp/prd.md',
      maxCycles: 5,
      reviewRounds: 2,
      models: ['codex'],
    }, ctx)
    expect(prepared.maxCycles).toBe(5)
    expect(prepared.reviewRounds).toBe(2)
    expect(prepared.models).toEqual(['codex'])
  })

  it('clamps maxCycles and reviewRounds to at least 1', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const prepared = await prepareHarnessInput({
      goal: 'g',
      prdPath: '/tmp/prd.md',
      maxCycles: -1,
      reviewRounds: 0,
    }, ctx)
    expect(prepared.maxCycles).toBe(1)
    expect(prepared.reviewRounds).toBe(1)
  })

  it('falls back to default models when given empty array', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const prepared = await prepareHarnessInput({
      goal: 'g',
      prdPath: '/tmp/prd.md',
      models: [],
    }, ctx)
    expect(prepared.models).toEqual(['kiro', 'codex'])
  })

  it('keeps config-driven reviewer selection on resume when models were not explicitly chosen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-prepare-resume-config-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:
  kiro:
    enabled: true
  codex:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  primary:
    tool: kiro
    prompt: primary review
  secondary:
    tool: codex
    prompt: secondary review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  harness:
    default_reviewers:
      - primary
      - secondary
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'g',
      prdPath: '/tmp/prd.md',
      models: ['kiro', 'codex'],
      modelsExplicit: false,
    }, ctx)

    expect(prepared.modelsExplicit).toBe(false)
    expect(prepared.models).toEqual(['kiro', 'codex'])
  })

  it('uses configured harness reviewers when models are omitted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-prepare-config-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:
  kiro:
    enabled: true
  codex:
    enabled: true
reviewers:
  primary:
    tool: kiro
    agent: go-reviewer
    prompt: primary review
  secondary:
    tool: codex
    prompt: secondary review
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
summarizer:
  model: kiro
  prompt: summarize
analyzer:
  model: codex
  prompt: analyze
capabilities:
  harness:
    default_reviewers:
      - primary
      - secondary
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const prepared = await prepareHarnessInput({
      goal: 'g',
      prdPath: '/tmp/prd.md',
    }, ctx)

    expect(prepared.models).toEqual(['kiro', 'codex'])
  })

  it('fails fast when the config file is malformed and models depend on config defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-prepare-bad-config-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, 'providers:\n  kiro: [\n', 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })

    await expect(prepareHarnessInput({
      goal: 'g',
      prdPath: '/tmp/prd.md',
    }, ctx)).rejects.toThrow()
  })

  it('persists whether reviewer models were explicitly chosen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-persist-explicit-'))
    const magpieHome = join(dir, '.magpie-home')
    mkdirSync(magpieHome, { recursive: true })
    process.env.MAGPIE_HOME = magpieHome
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:
  kiro:
    enabled: true
  codex:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  primary:
    tool: kiro
    prompt: primary review
  secondary:
    tool: codex
    prompt: secondary review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  harness:
    default_reviewers:
      - primary
      - secondary
  loop:
    enabled: true
    planner_model: mock
    executor_model: mock
  issue_fix:
    enabled: true
    planner_model: mock
    executor_model: mock
  quality:
    unitTestEval:
      enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

    const runCapabilityMock = vi.mocked(runCapability)
    runCapabilityMock.mockImplementation(async (module, input) => {
      if (module.name === 'loop') {
        return {
          prepared: {} as never,
          result: { status: 'completed', session: { id: 'loop-persist' } },
          output: {} as never,
        }
      }
      if (module.name === 'review') {
        const reviewOutput = (input as { options: { output: string } }).options.output
        await writeFile(reviewOutput, JSON.stringify({ parsedIssues: [] }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      if (module.name === 'quality/unit-test-eval') {
        return {
          prepared: {} as never,
          result: {
            generatedTests: [],
            coverage: { sourceFileCount: 1, testFileCount: 1, estimatedCoverage: 1 },
            scores: [],
            testRun: { command: 'npm run test:run', passed: true, output: 'all good', exitCode: 0 },
          },
          output: {} as never,
        }
      }
      if (module.name === 'discuss') {
        const outputPath = (input as { options: { output: string } }).options.output
        await writeFile(outputPath, JSON.stringify({
          finalConclusion: '```json\n{"decision":"approved","rationale":"ready","requiredActions":[]}\n```',
        }, null, 2), 'utf-8')
        return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
      }
      return { prepared: {} as never, result: { status: 'completed' }, output: { summary: 'ok' } }
    })

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const prepared = await prepareHarnessInput({
        goal: 'Deliver checkout v2',
        prdPath: join(dir, 'docs', 'prd.md'),
      }, ctx)
      const result = await executeHarness(prepared, ctx)
      const evidence = result.session?.evidence as { input?: { modelsExplicit?: boolean } } | undefined

      expect(result.status).toBe('completed')
      expect(evidence?.input?.modelsExplicit).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
    }
  })
})

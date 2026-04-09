import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  }
})

import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { runCapability } from '../../../src/core/capability/runner.js'
import { executeHarness } from '../../../src/capabilities/workflows/harness/application/execute.js'
import { prepareHarnessInput } from '../../../src/capabilities/workflows/harness/application/prepare.js'

vi.mock('../../../src/core/capability/runner.js', () => ({
  runCapability: vi.fn(),
}))

interface ConfigOptions {
  loopPlannerModel?: string
  loopExecutorModel?: string
  issueFixPlannerModel?: string
  issueFixExecutorModel?: string
}

function writeConfig(configPath: string, options: ConfigOptions = {}): void {
  writeFileSync(configPath, `providers:
  claude-code:
    enabled: true
  gemini-cli:
    enabled: true
  kiro:
    enabled: true
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
    vi.clearAllMocks()
  })

  it('completes when adversarial models approve and tests pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-ok-'))
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
      expect(result.session?.artifacts.providerSelectionPath).toBeTruthy()
      const harnessConfig = readFileSync(result.session!.artifacts.harnessConfigPath, 'utf-8')
      expect(harnessConfig).toContain('planner_model: claude-code')
      expect(harnessConfig).toContain('executor_model: claude-code')
      const selection = readJson<{
        decision: string
        hasPreciseUsage: boolean
        replacements: string[]
      }>(result.session!.artifacts.providerSelectionPath)
      expect(selection.decision).toBe('keep_claude')
      expect(selection.hasPreciseUsage).toBe(false)
      expect(selection.replacements).toEqual([])
      const calledNames = runCapabilityMock.mock.calls.map(([module]) => module.name)
      expect(calledNames).not.toContain('issue-fix')
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
      expect(issueFixCalls).toBe(2)
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
})

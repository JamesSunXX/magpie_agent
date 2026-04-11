import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.hoisted(() => vi.fn())
const knowledgeMocks = vi.hoisted(() => ({
  failPromote: false,
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

vi.mock('../../../src/core/capability/runner.js', () => ({
  runCapability: vi.fn(),
}))

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
    vi.clearAllMocks()
    knowledgeMocks.failPromote = false
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
})

describe('prepareHarnessInput', () => {
  it('applies default values when optional fields are omitted', async () => {
    const ctx = createCapabilityContext({ cwd: '/tmp' })
    const prepared = await prepareHarnessInput({ goal: 'ship it', prdPath: '/tmp/prd.md' }, ctx)
    expect(prepared.maxCycles).toBe(3)
    expect(prepared.reviewRounds).toBe(3)
    expect(prepared.models).toEqual(['gemini-cli', 'kiro'])
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
    expect(prepared.models).toEqual(['gemini-cli', 'kiro'])
  })
})

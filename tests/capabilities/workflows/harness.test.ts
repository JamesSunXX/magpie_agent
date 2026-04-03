import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { runCapability } from '../../../src/core/capability/runner.js'
import { executeHarness } from '../../../src/capabilities/workflows/harness/application/execute.js'
import { prepareHarnessInput } from '../../../src/capabilities/workflows/harness/application/prepare.js'

vi.mock('../../../src/core/capability/runner.js', () => ({
  runCapability: vi.fn(),
}))

function writeConfig(configPath: string): void {
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
    writeConfig(configPath)

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
})

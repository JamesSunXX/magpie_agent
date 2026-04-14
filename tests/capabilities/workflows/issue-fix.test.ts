import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { issueFixCapability } from '../../../src/capabilities/workflows/issue-fix/index.js'
import { resolveIssueFixAgent } from '../../../src/capabilities/workflows/issue-fix/application/execute.js'

const issueFixPlanningMocks = vi.hoisted(() => ({
  createPlanContext: vi.fn().mockResolvedValue({
    providerId: 'jira_main',
    itemKey: 'ENG-42',
    summary: 'Remote planning context:\n- Ticket: ENG-42\n- Summary: Fix planner context injection',
  }),
  syncPlanArtifact: vi.fn().mockResolvedValue({ synced: true }),
}))

const issueFixProviderMocks = vi.hoisted(() => ({
  plannerGeminiFailures: 0,
  executorGeminiFailures: 0,
  calls: [] as Array<{ logicalName: string; tool?: string; model?: string }>,
}))

vi.mock('../../../src/platform/integrations/planning/factory.js', () => ({
  createPlanningRouter: vi.fn(() => ({
    createPlanContext: issueFixPlanningMocks.createPlanContext,
    syncPlanArtifact: issueFixPlanningMocks.syncPlanArtifact,
  })),
}))

vi.mock('../../../src/platform/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/platform/providers/index.js')>()
  return {
    ...actual,
    createConfiguredProvider: vi.fn((input: { logicalName: string; tool?: string; model?: string }) => ({
      setCwd: vi.fn(),
      chat: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
        issueFixProviderMocks.calls.push({
          logicalName: input.logicalName,
          tool: input.tool,
          model: input.model,
        })

        const content = messages.at(-1)?.content || ''
        const isGemini = input.tool === 'gemini'
          || input.model === 'gemini-cli'
          || input.model?.startsWith('gemini')
        const isPlanner = input.logicalName.endsWith('.planner')
        const isExecutor = input.logicalName.endsWith('.executor')

        if (isGemini && isPlanner && issueFixProviderMocks.plannerGeminiFailures > 0) {
          issueFixProviderMocks.plannerGeminiFailures -= 1
          throw new Error('Gemini CLI exited with code 1: Error when talking to Gemini API ModelNotFoundError: Requested entity was not found. code: 404')
        }

        if (isGemini && isExecutor && issueFixProviderMocks.executorGeminiFailures > 0) {
          issueFixProviderMocks.executorGeminiFailures -= 1
          throw new Error('Gemini CLI exited with code 1: Error when talking to Gemini API ModelNotFoundError: Requested entity was not found. code: 404')
        }

        if (isPlanner) {
          return `[PLAN] ${content}`
        }
        if (isExecutor) {
          return `[EXEC] ${content}`
        }
        return `[MOCK] ${content}`
      }),
    })),
  }
})

describe('issue-fix workflow', () => {
  it('drops kiro-only agent metadata when routing picks a non-kiro provider', () => {
    expect(resolveIssueFixAgent({
      tool: 'codex',
      model: 'codex',
    }, 'architect')).toBeUndefined()

    expect(resolveIssueFixAgent({
      tool: 'gemini',
      model: 'gemini-cli',
    }, 'dev')).toBeUndefined()
  })

  it('keeps runtime agents only for kiro bindings', () => {
    expect(resolveIssueFixAgent({
      tool: 'kiro',
      model: 'kiro',
    }, 'architect')).toBe('architect')

    expect(resolveIssueFixAgent({
      tool: 'kiro',
      model: 'kiro',
      agent: 'dev',
    }, 'architect')).toBe('dev')
  })

  afterEach(() => {
    issueFixPlanningMocks.createPlanContext.mockClear()
    issueFixPlanningMocks.syncPlanArtifact.mockClear()
    issueFixProviderMocks.plannerGeminiFailures = 0
    issueFixProviderMocks.executorGeminiFailures = 0
    issueFixProviderMocks.calls.length = 0
  })

  it('stores workflow artifacts under the repo-local .magpie sessions directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-issue-fix-home-'))
    const magpieHome = join(dir, '.magpie-test-home')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  issue_fix:\n    enabled: true\n    planner_model: mock\n    planner_agent: architect\n    executor_model: mock\n    executor_agent: implementer\n    auto_commit: false\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const previousMagpieHome = process.env.MAGPIE_HOME
    process.env.MAGPIE_HOME = magpieHome

    try {
      const ctx = createCapabilityContext({ cwd: dir, configPath })
      const result = await runCapability(issueFixCapability, {
        issue: 'Add input validation to sum() and describe the fix.',
        apply: false,
      }, ctx)

      expect(result.result.status).toBe('completed')
      expect(result.result.session?.artifacts.planPath).toContain(join(dir, '.magpie', 'sessions', 'issue-fix'))
      expect(result.result.session?.artifacts.executionPath).toContain(join(dir, '.magpie', 'sessions', 'issue-fix'))
    } finally {
      if (previousMagpieHome === undefined) {
        delete process.env.MAGPIE_HOME
      } else {
        process.env.MAGPIE_HOME = previousMagpieHome
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a persisted issue-fix session with plan and execution artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-issue-fix-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  issue_fix:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    verify_command: "node --version"\n    auto_commit: false\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(issueFixCapability, {
      issue: 'Add input validation to sum() and describe the fix.',
      apply: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.planPath).toBeTruthy()
    expect(result.result.session?.artifacts.executionPath).toBeTruthy()
    expect(readFileSync(result.result.session!.artifacts.planPath, 'utf-8')).toContain('Add input validation')
  })

  it('syncs issue-fix artifacts to the planning router when configured', async () => {
    issueFixPlanningMocks.createPlanContext.mockClear()
    issueFixPlanningMocks.syncPlanArtifact.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'magpie-issue-fix-planning-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  issue_fix:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    verify_command: "node --version"\n    auto_commit: false\nintegrations:\n  notifications:\n    enabled: false\n  planning:\n    enabled: true\n    default_provider: jira_main\n    providers:\n      jira_main:\n        type: jira\n        base_url: https://example.atlassian.net\n        project_key: ENG\n        email: bot@example.com\n        api_token: token\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    await runCapability(issueFixCapability, {
      issue: 'Add input validation to sum() and describe the fix.',
      apply: false,
    }, ctx)

    expect(issueFixPlanningMocks.syncPlanArtifact).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Add input validation'),
    }))
  })

  it('injects fetched planning context into the issue-fix planner prompt', async () => {
    issueFixPlanningMocks.createPlanContext.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'magpie-issue-fix-context-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  issue_fix:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    auto_commit: false\nintegrations:\n  notifications:\n    enabled: false\n  planning:\n    enabled: true\n    default_provider: jira_main\n    providers:\n      jira_main:\n        type: jira\n        base_url: https://example.atlassian.net\n        project_key: ENG\n        email: bot@example.com\n        api_token: token\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(issueFixCapability, {
      issue: 'ENG-42 Add input validation to sum() and describe the fix.',
      apply: false,
    }, ctx)

    expect(issueFixPlanningMocks.createPlanContext).toHaveBeenCalledWith(expect.objectContaining({
      itemKey: 'ENG-42',
    }))
    expect(readFileSync(result.result.session!.artifacts.planPath, 'utf-8')).toContain('Remote planning context:')
  })

  it('falls back to kiro when gemini issue-fix planner or executor returns a known model error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-issue-fix-gemini-fallback-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b\n', 'utf-8')

    issueFixProviderMocks.plannerGeminiFailures = 1
    issueFixProviderMocks.executorGeminiFailures = 1

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  gemini-cli:\n    enabled: true\n  kiro:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  issue_fix:\n    enabled: true\n    planner_model: gemini-cli\n    executor_model: gemini-cli\n    auto_commit: false\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(issueFixCapability, {
      issue: 'Recover from gemini planner failures inside issue-fix.',
      apply: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(issueFixProviderMocks.calls).toEqual([
      expect.objectContaining({ logicalName: 'capabilities.issue_fix.planner', model: 'gemini-cli' }),
      expect.objectContaining({ logicalName: 'capabilities.issue_fix.planner', tool: 'kiro', model: 'kiro' }),
      expect.objectContaining({ logicalName: 'capabilities.issue_fix.executor', model: 'gemini-cli' }),
      expect.objectContaining({ logicalName: 'capabilities.issue_fix.executor', tool: 'kiro', model: 'kiro' }),
    ])
    expect(readFileSync(result.result.session!.artifacts.planPath, 'utf-8')).toContain('[PLAN]')
    expect(readFileSync(result.result.session!.artifacts.executionPath, 'utf-8')).toContain('[EXEC]')
  })
})

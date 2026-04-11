import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { loopCapability } from '../../../src/capabilities/loop/index.js'

const planningMocks = vi.hoisted(() => ({
  createPlanContext: vi.fn().mockResolvedValue({
    providerId: 'jira_main',
    itemKey: 'ENG-99',
    summary: 'Remote planning context:\n- Ticket: ENG-99\n- Scope: Keep loop plan aligned with linked work item',
  }),
  syncPlanArtifact: vi.fn().mockResolvedValue({ synced: true }),
}))

const plannerMocks = vi.hoisted(() => ({
  generateLoopPlan: vi.fn().mockResolvedValue([
    {
      id: 'task-1',
      stage: 'prd_review',
      title: 'prd_review',
      description: 'Execute prd_review',
      dependencies: [],
      successCriteria: ['Stage prd_review completed'],
    },
  ]),
}))

const knowledgeMocks = vi.hoisted(() => ({
  failPromote: false,
}))

vi.mock('../../../src/platform/integrations/planning/factory.js', () => ({
  createPlanningRouter: vi.fn(() => ({
    createPlanContext: planningMocks.createPlanContext,
    syncPlanArtifact: planningMocks.syncPlanArtifact,
  })),
}))

vi.mock('../../../src/capabilities/loop/domain/planner.js', () => ({
  generateLoopPlan: plannerMocks.generateLoopPlan,
}))

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

describe('loop capability', () => {
  afterEach(() => {
    knowledgeMocks.failPromote = false
  })

  it('runs a minimal dry-run loop session with mock providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({
      cwd: dir,
      configPath,
    })

    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session).toBeDefined()
    expect(result.result.session?.stages).toEqual(['prd_review'])
    expect(result.result.session?.artifacts.knowledgeSchemaPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeIndexPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeLogPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeStatePath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeSummaryDir).toBeTruthy()
    expect(existsSync(result.result.session!.artifacts.knowledgeSchemaPath)).toBe(true)
    expect(existsSync(result.result.session!.artifacts.knowledgeStatePath!)).toBe(true)
    expect(existsSync(join(result.result.session!.artifacts.knowledgeSummaryDir, 'goal.md'))).toBe(true)
    expect(existsSync(join(result.result.session!.artifacts.knowledgeSummaryDir, 'plan.md'))).toBe(true)
    expect(readFileSync(result.result.session!.artifacts.knowledgeStatePath!, 'utf-8')).toContain('"currentStage": "completed"')
  })

  it('persists a completed loop session even if knowledge promotion fails', async () => {
    knowledgeMocks.failPromote = true

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-knowledge-fail-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.status).toBe('completed')
  })

  it('syncs loop plan artifacts to the planning router when configured', async () => {
    planningMocks.createPlanContext.mockClear()
    planningMocks.syncPlanArtifact.mockClear()
    plannerMocks.generateLoopPlan.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-planning-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n  planning:\n    enabled: true\n    default_provider: jira_main\n    providers:\n      jira_main:\n        type: jira\n        base_url: https://example.atlassian.net\n        project_key: ENG\n        email: bot@example.com\n        api_token: token\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(planningMocks.syncPlanArtifact).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Goal: Complete delivery flow'),
    }))
  })

  it('passes fetched planning context into loop planning', async () => {
    planningMocks.createPlanContext.mockClear()
    plannerMocks.generateLoopPlan.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-context-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'ENG-99-sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n  planning:\n    enabled: true\n    default_provider: jira_main\n    providers:\n      jira_main:\n        type: jira\n        base_url: https://example.atlassian.net\n        project_key: ENG\n        email: bot@example.com\n        api_token: token\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    await runCapability(loopCapability, {
      mode: 'run',
      goal: 'ENG-99 Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(planningMocks.createPlanContext).toHaveBeenCalledWith(expect.objectContaining({
      itemKey: 'ENG-99',
    }))
    expect(plannerMocks.generateLoopPlan).toHaveBeenCalledWith(
      expect.anything(),
      'ENG-99 Complete delivery flow',
      prdPath,
      ['prd_review'],
      expect.stringContaining('Remote planning context:')
    )
  })

  it('does not create or switch branches in dry-run mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-git-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/unsafe prefix; rm -rf /"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const beforeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const ctx = createCapabilityContext({ cwd: dir, configPath })

    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    const afterBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const branchList = execSync('git branch --list "sch/*"', { cwd: dir, encoding: 'utf-8' }).trim()

    expect(result.result.status).toBe('completed')
    expect(afterBranch).toBe(beforeBranch)
    expect(branchList).toBe('')
  })

  it('sanitizes branch prefixes before creating git branches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-branch-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/unsafe prefix; rm -rf /"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBeDefined()
    expect(result.result.session?.branchName).toMatch(/^sch\//)
    expect(result.result.session?.branchName).not.toContain(';')
    expect(currentBranch).toBe(result.result.session?.branchName)
  })

  it('reuses the current feature branch for auto-commit when configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-reuse-branch-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    reuse_current_branch: true\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')
    execSync('git add README.md docs/sample-prd.md config.yaml', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
    execSync('git checkout -b feature/current-branch', { cwd: dir, stdio: 'pipe' })

    writeFileSync(join(dir, 'pending-change.txt'), 'should be auto-committed on current branch\n', 'utf-8')

    const beforeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const beforeCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const ctx = createCapabilityContext({ cwd: dir, configPath })

    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const afterBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const afterCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const headMessage = execSync('git log -1 --pretty=%s', { cwd: dir, encoding: 'utf-8' }).trim()
    const schBranches = execSync('git branch --list "sch/*"', { cwd: dir, encoding: 'utf-8' }).trim()

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBe(beforeBranch)
    expect(afterBranch).toBe(beforeBranch)
    expect(afterCommit).not.toBe(beforeCommit)
    expect(headMessage).toBe('feat(loop): 完成prd_review')
    expect(schBranches).toBe('')
  })

  it('still creates a new branch from main when current branch reuse is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-safe-main-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    reuse_current_branch: true\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')
    execSync('git add README.md docs/sample-prd.md config.yaml', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    writeFileSync(join(dir, 'pending-change.txt'), 'should trigger auto-commit on a new branch\n', 'utf-8')

    const beforeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const ctx = createCapabilityContext({ cwd: dir, configPath })

    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const afterBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBeDefined()
    expect(result.result.session?.branchName).not.toBe(beforeBranch)
    expect(result.result.session?.branchName).toMatch(/^sch\//)
    expect(afterBranch).toBe(result.result.session?.branchName)
  })

  it('does not auto-commit onto the current branch when the configured prefix is not a valid git ref', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-no-branch-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'pending-change.txt'), 'should stay uncommitted\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/invalid..ref"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const beforeCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const beforeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const afterCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const afterBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' })
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBeUndefined()
    expect(afterCommit).toBe(beforeCommit)
    expect(afterBranch).toBe(beforeBranch)
    expect(status).toContain('pending-change.txt')
    expect(events).toContain('"event":"auto_commit_disabled"')
  })

  it('rejects shell metacharacters in configured test commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-cmd-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const markerPath = join(dir, 'should-not-exist.txt')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "touch ${markerPath} && echo unsafe"\n      mock_test: "echo safe"\n      integration_test: "echo safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('failed')
    expect(existsSync(markerPath)).toBe(false)
  })

  it('creates an isolated worktree for complex runs and persists workspace metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-worktree-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.worktrees'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, '.gitignore'), '.worktrees/*\n', 'utf-8')
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md .gitignore', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const beforeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
      complexity: 'complex',
    }, ctx)

    const afterBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.workspaceMode).toBe('worktree')
    expect(result.result.session?.artifacts.workspacePath).toContain(`${dir}/.worktrees/`)
    expect(result.result.session?.artifacts.workspacePath).not.toBe(dir)
    expect(result.result.session?.artifacts.worktreeBranch).toMatch(/^sch\//)
    expect(result.result.session?.branchName).toBe(result.result.session?.artifacts.worktreeBranch)
    expect(existsSync(join(result.result.session!.artifacts.workspacePath!, '.git'))).toBe(true)
    expect(result.result.session?.artifacts.humanConfirmationPath).toBe(
      join(result.result.session!.artifacts.workspacePath!, 'human_confirmation.md')
    )
    expect(afterBranch).toBe(beforeBranch)
  })

  it('writes human confirmation files inside the isolated worktree when a complex run pauses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-worktree-human-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.worktrees'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, '.gitignore'), '.worktrees/\n', 'utf-8')
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md .gitignore', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: summarize\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 1\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "always"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
      complexity: 'complex',
    }, ctx)

    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(result.result.session?.artifacts.workspaceMode).toBe('worktree')
    expect(result.result.session?.artifacts.humanConfirmationPath).toBe(
      join(result.result.session!.artifacts.workspacePath!, 'human_confirmation.md')
    )
    expect(existsSync(result.result.session!.artifacts.humanConfirmationPath)).toBe(true)
    expect(existsSync(join(dir, 'human_confirmation.md'))).toBe(false)
  })

  it('fails complex runs when the worktree directory is not ignored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-worktree-ignore-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.worktrees'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
      complexity: 'complex',
    }, ctx)

    expect(result.result.status).toBe('failed')
    expect(result.result.session?.artifacts.workspaceMode).toBe('current')
    expect(readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')).toContain('worktree')
  })

  it('skips mock tests by default when no mock command is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-default-mock-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
  })
})

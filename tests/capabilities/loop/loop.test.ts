import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { StateManager, type LoopSession } from '../../../src/core/state/index.js'
import { loopCapability } from '../../../src/capabilities/loop/index.js'
import type { ProviderBindingInput, AIProvider } from '../../../src/platform/providers/index.js'

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

const providerMocks = vi.hoisted(() => ({
  factory: null as null | ((
    input: ProviderBindingInput,
    config: unknown,
    actual: typeof import('../../../src/platform/providers/index.js')
  ) => AIProvider),
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

vi.mock('../../../src/platform/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/platform/providers/index.js')>()
  return {
    ...actual,
    createConfiguredProvider: vi.fn((input: ProviderBindingInput, config: unknown) => {
      if (providerMocks.factory) {
        return providerMocks.factory(input, config, actual)
      }
      return actual.createConfiguredProvider(input, config as never)
    }),
  }
})

describe('loop capability', () => {
  afterEach(() => {
    knowledgeMocks.failPromote = false
    providerMocks.factory = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('dispatches stage-aware notifications for entered and completed stages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-stage-notify-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: true\n    stage_ai:\n      enabled: true\n      provider: mock\n      max_summary_chars: 900\n      include_loop: true\n      include_harness: true\n    routes:\n      stage_entered: [feishu_team]\n      stage_completed: [feishu_team]\n    providers:\n      feishu_team:\n        type: feishu-webhook\n        webhook_url: https://example.com/hook\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(events).toContain('"event":"stage_entered"')
    expect(events).toContain('"event":"stage_completed"')
    expect(fetchMock).toHaveBeenCalled()
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
    expect(result.result.session?.roles?.map((role) => role.roleId)).toEqual(['architect', 'developer', 'tester'])
    expect(result.result.session?.artifacts.roleRosterPath).toBeTruthy()
    expect(result.result.session?.artifacts.roleMessagesPath).toBeTruthy()
    expect(existsSync(result.result.session!.artifacts.roleRosterPath!)).toBe(true)
    expect(readFileSync(result.result.session!.artifacts.roleMessagesPath!, 'utf-8')).toContain('"kind":"plan_request"')
    expect(result.result.session?.artifacts.knowledgeSchemaPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeIndexPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeLogPath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeStatePath).toBeTruthy()
    expect(result.result.session?.artifacts.knowledgeSummaryDir).toBeTruthy()
    expect(result.result.session?.artifacts.documentPlanPath).toBeTruthy()
    expect(existsSync(result.result.session!.artifacts.knowledgeSchemaPath)).toBe(true)
    expect(existsSync(result.result.session!.artifacts.knowledgeStatePath!)).toBe(true)
    expect(existsSync(result.result.session!.artifacts.documentPlanPath!)).toBe(true)
    expect(existsSync(join(result.result.session!.artifacts.knowledgeSummaryDir, 'goal.md'))).toBe(true)
    expect(existsSync(join(result.result.session!.artifacts.knowledgeSummaryDir, 'plan.md'))).toBe(true)
    expect(readFileSync(result.result.session!.artifacts.knowledgeStatePath!, 'utf-8')).toContain('"currentStage": "completed"')
  })

  it('completes the stage when evaluation JSON cannot be parsed under manual_only policy', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn()
            .mockResolvedValueOnce('This is not valid JSON output.')
            .mockResolvedValue('This is not valid JSON output.'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => '# Stage Report\n\nCompleted the PRD review.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-eval-parse-fail-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const confirmationPath = result.result.session!.artifacts.humanConfirmationPath
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.status).toBe('completed')
    expect(existsSync(confirmationPath)).toBe(false)
    expect(events).not.toContain('"event":"human_confirmation_required"')
    expect(events).not.toContain('"event":"stage_paused"')
    expect(events).toContain('"event":"stage_completed"')
  })

  it('applies loop role binding overrides and persists the active role roster', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-role-bindings-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_tool: kiro\n    planner_model: mock\n    executor_tool: claw\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    role_bindings:\n      architect:\n        tool: codex\n      developer:\n        tool: codex\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner' || input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(result.result.session?.roles).toMatchObject([
      { roleId: 'architect', binding: { tool: 'codex' } },
      { roleId: 'developer', binding: { tool: 'codex' } },
      { roleId: 'tester', binding: { tool: 'codex' } },
    ])
    expect(readFileSync(result.result.session!.artifacts.roleRosterPath!, 'utf-8')).toContain('"roleId": "architect"')
    expect(readFileSync(result.result.session!.artifacts.roleRosterPath!, 'utf-8')).toContain('"tool": "codex"')
  })

  it('persists codex progress events to the loop event stream', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'codex',
          chat: vi.fn(async (_messages, _systemPrompt, options) => {
            options?.onProgress?.({
              provider: 'codex',
              kind: 'turn.started',
              summary: 'Codex turn started.',
            })
            options?.onProgress?.({
              provider: 'codex',
              kind: 'item.started',
              summary: 'Running shell command.',
              details: {
                itemType: 'exec_command',
              },
            })
            return '# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-codex-progress-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: codex\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Expose codex progress',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    expect(events).toContain('"event":"provider_progress"')
    expect(events).toContain('"provider":"codex"')
    expect(events).toContain('"progressType":"turn.started"')
    expect(events).toContain('"summary":"Codex turn started."')
    expect(events).toContain('"progressType":"item.started"')
  })

  it('applies configured execution timeout per stage and complexity', async () => {
    const plannerSetTimeout = vi.fn()
    const executorSetTimeout = vi.fn()

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          setTimeoutMs: plannerSetTimeout,
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          setTimeoutMs: executorSetTimeout,
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-timeout-'))
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [domain_partition]\n    execution_timeout:\n      default_ms: 600000\n      min_ms: 300000\n      max_ms: 3600000\n      complexity_multiplier:\n        simple: 1\n        standard: 2\n        complex: 3\n      stage_overrides_ms:\n        domain_partition: 600000\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Apply dynamic execution timeout',
      prdPath,
      waitHuman: false,
      dryRun: false,
      complexity: 'complex',
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(plannerSetTimeout).toHaveBeenCalledWith(1800000)
    expect(executorSetTimeout).toHaveBeenCalledWith(1800000)
    expect(events).toContain('"event":"stage_entered"')
    expect(events).toContain('"stage":"domain_partition"')
    expect(events).toContain('"timeoutMs":1800000')
  })

  it('keeps the stored complexity tier when resuming without an override', async () => {
    const plannerSetTimeout = vi.fn()
    const executorSetTimeout = vi.fn()

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          setTimeoutMs: plannerSetTimeout,
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          setTimeoutMs: executorSetTimeout,
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-resume-timeout-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [domain_partition]\n    execution_timeout:\n      default_ms: 600000\n      min_ms: 300000\n      max_ms: 3600000\n      complexity_multiplier:\n        simple: 1\n        standard: 2\n        complex: 3\n      stage_overrides_ms:\n        domain_partition: 600000\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    const sessionId = 'resume-timeout-tier'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    await stateManager.saveLoopSession({
      id: sessionId,
      title: 'Resume timeout tier',
      goal: 'Resume timeout tier',
      prdPath,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['domain_partition'],
      plan: [{
        id: 'task-1',
        stage: 'domain_partition',
        title: 'domain_partition',
        description: 'Execute domain partition',
        dependencies: [],
        successCriteria: ['Stage completed'],
      }],
      stageResults: [],
      humanConfirmations: [],
      selectedComplexity: 'complex',
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
        workspaceMode: 'current',
        workspacePath: dir,
      },
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(plannerSetTimeout).toHaveBeenCalledWith(1800000)
    expect(executorSetTimeout).toHaveBeenCalledWith(1800000)
    expect(events).toContain('"timeoutMs":1800000')
  })

  it('backfills complex timeout tier for legacy worktree sessions on resume', async () => {
    const plannerSetTimeout = vi.fn()
    const executorSetTimeout = vi.fn()

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          setTimeoutMs: plannerSetTimeout,
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          setTimeoutMs: executorSetTimeout,
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-legacy-resume-timeout-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [domain_partition]\n    execution_timeout:\n      default_ms: 600000\n      min_ms: 300000\n      max_ms: 3600000\n      complexity_multiplier:\n        simple: 1\n        standard: 2\n        complex: 3\n      stage_overrides_ms:\n        domain_partition: 600000\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    const sessionId = 'legacy-resume-timeout-tier'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    await stateManager.saveLoopSession({
      id: sessionId,
      title: 'Legacy resume timeout tier',
      goal: 'Legacy resume timeout tier',
      prdPath,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['domain_partition'],
      plan: [{
        id: 'task-1',
        stage: 'domain_partition',
        title: 'domain_partition',
        description: 'Execute domain partition',
        dependencies: [],
        successCriteria: ['Stage completed'],
      }],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: join(dir, '.worktrees', 'legacy', 'human_confirmation.md'),
        workspaceMode: 'worktree',
        workspacePath: join(dir, '.worktrees', 'legacy'),
        worktreeBranch: 'sch/legacy-timeout',
      },
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(plannerSetTimeout).toHaveBeenCalledWith(1800000)
    expect(executorSetTimeout).toHaveBeenCalledWith(1800000)
    expect(result.result.session?.selectedComplexity).toBe('complex')
    expect(events).toContain('"timeoutMs":1800000')
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

  it('pauses before code development when constraints block the planned work', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Implement checkout client',
        description: 'Use axios to call the upstream service',
        dependencies: [],
        successCriteria: ['Checkout client implemented'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-constraints-block-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.magpie'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nCheckout client.', 'utf-8')
    writeFileSync(join(dir, '.magpie', 'constraints.json'), JSON.stringify({
      version: 1,
      sourcePrdPath: prdPath,
      sourceTrdPath: join(dir, 'sample.trd.md'),
      generatedAt: '2026-04-12T00:00:00.000Z',
      rules: [
        {
          id: 'dependency-no-axios',
          category: 'dependency',
          description: '禁止引入 axios',
          severity: 'error',
          scope: 'repository',
          checkType: 'forbidden_dependency',
          expected: [],
          forbidden: ['axios'],
        },
      ],
    }, null, 2), 'utf-8')

    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Build checkout client with axios',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(result.result.session?.constraintsValidated).toBe(true)
    expect(result.result.session?.constraintCheckStatus).toBe('blocked')
    expect(result.result.session?.lastReliablePoint).toBe('constraints_validated')
    expect(result.result.session?.lastFailureReason).toContain('axios')
    expect(events).toContain('"event":"constraints_blocked"')
  })

  it('confirms a red test before code development for TDD-eligible tasks', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-tdd-red-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.magpie'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'const fs = require("fs"); process.exit(fs.existsSync("ready.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    let executorCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            if (executorCalls >= 2) {
              writeFileSync(join(dir, 'ready.flag'), 'ready', 'utf-8')
            }
            return '# Stage Report\n\nPrepared code development output.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Add amount formatter utility',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const sessionDir = result.result.session!.artifacts.sessionDir
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    const redIndex = events.indexOf('"event":"red_test_confirmed"')
    const stageIndex = events.indexOf('"event":"stage_entered"')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.tddEligible).toBe(true)
    expect(result.result.session?.redTestConfirmed).toBe(true)
    expect(result.result.session?.currentLoopState).toBe('completed')
    expect(result.result.session?.lastReliablePoint).toBe('completed')
    expect(existsSync(join(sessionDir, 'tdd', 'target.md'))).toBe(true)
    expect(existsSync(join(sessionDir, 'tdd', 'red-test-result.json'))).toBe(true)
    expect(existsSync(join(sessionDir, 'tdd', 'green-test-result.json'))).toBe(true)
    expect(redIndex).toBeGreaterThan(-1)
    expect(stageIndex).toBeGreaterThan(redIndex)
  })

  it('pauses before implementation when the red test command itself is broken', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-red-command-broken-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "magpie-command-that-does-not-exist"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Add amount formatter utility',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    expect(result.result.status).toBe('paused')
    expect(result.result.session?.redTestConfirmed).not.toBe(true)
    expect(result.result.session?.currentLoopState).toBe('retrying_execution')
    expect(result.result.session?.executionRetryCount).toBe(1)
    expect(result.result.session?.lastFailureReason).toContain('Red test could not be established')
    expect(events).toContain('"event":"red_test_execution_retry_required"')
  })

  it('automatically retries a failed quality fix before pausing the loop', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-quality-auto-retry-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.magpie'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'const fs = require("fs"); process.exit(fs.existsSync("ready.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    let executorCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            if (executorCalls >= 3) {
              writeFileSync(join(dir, 'ready.flag'), 'ready', 'utf-8')
            }
            return '# Stage Report\n\nPrepared code development output.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Add amount formatter utility',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.repairAttemptCount).toBe(1)
    expect(result.result.session?.currentLoopState).toBe('completed')
    expect(executorCalls).toBe(3)
  })

  it('pauses with revising state when post-implementation tests still fail', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-quality-fail-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'process.exit(process.env.RED_PHASE === "1" ? 1 : 1)\n', 'utf-8')

    const originalEnv = process.env.RED_PHASE
    process.env.RED_PHASE = '1'
    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Add amount formatter utility',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)
    process.env.RED_PHASE = originalEnv

    const sessionDir = result.result.session!.artifacts.sessionDir
    expect(result.result.status).toBe('paused')
    expect(result.result.session?.currentLoopState).toBe('blocked_for_human')
    expect(result.result.session?.repairAttemptCount).toBe(3)
    expect(result.result.session?.lastReliablePoint).toBe('test_result_recorded')
    expect(existsSync(join(sessionDir, 'tdd', 'green-test-result.json'))).toBe(true)
    expect(existsSync(join(sessionDir, 'repairs', 'open-issues.md'))).toBe(true)
  })

  it('resumes code development from the confirmed red test checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-resume-red-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'const fs = require("fs"); process.exit(fs.existsSync("ready.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-resume-red'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    const eventsPath = join(sessionDir, 'events.jsonl')
    const planPath = join(sessionDir, 'plan.json')
    const redTestResultPath = join(sessionDir, 'tdd', 'red-test-result.json')
    const tddTargetPath = join(sessionDir, 'tdd', 'target.md')
    mkdirSync(join(sessionDir, 'tdd'), { recursive: true })
    writeFileSync(eventsPath, '', 'utf-8')
    writeFileSync(planPath, JSON.stringify([], null, 2), 'utf-8')
    writeFileSync(tddTargetPath, '# TDD Target\n\n- Keep formatter behavior stable.\n', 'utf-8')
    writeFileSync(redTestResultPath, JSON.stringify({
      command: 'node script.js',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:01.000Z',
      exitCode: 1,
      status: 'failed',
      output: 'Expected failure before implementation.',
      confirmed: true,
    }, null, 2), 'utf-8')

    const session: LoopSession = {
      id: sessionId,
      title: 'Resume from red test',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development'],
      plan: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Add amount formatter utility',
          description: 'Implement a pure formatter for checkout amounts',
          dependencies: [],
          successCriteria: ['Formatter output matches the spec'],
        },
      ],
      stageResults: [],
      humanConfirmations: [],
      constraintsValidated: true,
      constraintCheckStatus: 'pass',
      tddEligible: true,
      redTestConfirmed: true,
      lastReliablePoint: 'red_test_confirmed',
      artifacts: {
        sessionDir,
        repoRootPath: dir,
        workspaceMode: 'current',
        workspacePath: dir,
        eventsPath,
        planPath,
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
        tddTargetPath,
        redTestResultPath,
      },
    }

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    await stateManager.saveLoopSession(session)

    let executorCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            writeFileSync(join(dir, 'ready.flag'), 'ready', 'utf-8')
            return '# Stage Report\n\nImplemented formatter.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.currentLoopState).toBe('completed')
    expect(result.result.session?.lastReliablePoint).toBe('completed')
    expect(result.result.session?.redTestConfirmed).toBe(true)
    expect(executorCalls).toBe(1)
    expect(existsSync(join(sessionDir, 'tdd', 'green-test-result.json'))).toBe(true)
  })

  it('blocks resume when the saved checkpoint is not a complete reliable point', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-invalid-checkpoint-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-invalid-checkpoint'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    const eventsPath = join(sessionDir, 'events.jsonl')
    const planPath = join(sessionDir, 'plan.json')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(eventsPath, '', 'utf-8')
    writeFileSync(planPath, JSON.stringify([], null, 2), 'utf-8')

    const session: LoopSession = {
      id: sessionId,
      title: 'Invalid checkpoint',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development'],
      plan: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Add amount formatter utility',
          description: 'Implement a pure formatter for checkout amounts',
          dependencies: [],
          successCriteria: ['Formatter output matches the spec'],
        },
      ],
      stageResults: [],
      humanConfirmations: [],
      constraintsValidated: true,
      constraintCheckStatus: 'pass',
      tddEligible: true,
      redTestConfirmed: true,
      currentLoopState: 'revising',
      lastReliablePoint: 'half_written_output' as never,
      artifacts: {
        sessionDir,
        repoRootPath: dir,
        workspaceMode: 'current',
        workspacePath: dir,
        eventsPath,
        planPath,
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
      },
    }

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    await stateManager.saveLoopSession(session)

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(eventsPath, 'utf-8')
    expect(result.result.status).toBe('paused')
    expect(result.result.session?.currentLoopState).toBe('blocked_for_human')
    expect(result.result.session?.lastFailureReason).toContain('reliable checkpoint')
    expect(events).toContain('"event":"resume_blocked_invalid_checkpoint"')
  })

  it('consumes the execution retry budget before pausing for human help', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'code_development',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-execution-retry-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'runner.js'), `const fs = require('fs')
const { spawnSync } = require('child_process')
if (!fs.existsSync('impl.flag')) {
  process.exit(1)
}
const result = spawnSync('magpie-command-that-does-not-exist', [], { encoding: 'utf-8' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
`, 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node runner.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        let stageCalls = 0
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            stageCalls += 1
            if (stageCalls >= 2) {
              writeFileSync(join(dir, 'impl.flag'), 'ready', 'utf-8')
            }
            return '# Stage Report\n\nImplemented formatter.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const firstResult = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Add amount formatter utility',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(firstResult.result.status).toBe('paused')
    expect(firstResult.result.session?.currentLoopState).toBe('blocked_for_human')
    expect(firstResult.result.session?.executionRetryCount).toBe(2)
    expect(firstResult.result.session?.lastReliablePoint).toBe('test_result_recorded')
    expect(firstResult.result.session?.lastFailureReason).toContain('测试执行出现事故')
    expect(readFileSync(firstResult.result.session!.artifacts.eventsPath, 'utf-8')).toContain('"event":"execution_retry_restarted"')
  })

  it('retries execution-only failures on resume without regenerating code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-execution-resume-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'runner.js'), 'const fs = require("fs"); process.exit(fs.existsSync("resume-ok.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [code_development]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node runner.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-execution-resume'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    mkdirSync(join(sessionDir, 'tdd'), { recursive: true })
    writeFileSync(join(sessionDir, 'events.jsonl'), '', 'utf-8')
    writeFileSync(join(sessionDir, 'plan.json'), JSON.stringify([], null, 2), 'utf-8')
    writeFileSync(join(sessionDir, 'tdd', 'green-test-result.json'), JSON.stringify({
      command: 'node runner.js',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:01.000Z',
      exitCode: 1,
      status: 'failed',
      output: 'command failed before environment recovery',
      blocked: false,
      failureKind: 'execution',
      failedTests: [],
      firstError: 'temporary execution issue',
    }, null, 2), 'utf-8')

    const session: LoopSession = {
      id: sessionId,
      title: 'Resume execution retry',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development'],
      plan: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Add amount formatter utility',
          description: 'Implement a pure formatter for checkout amounts',
          dependencies: [],
          successCriteria: ['Formatter output matches the spec'],
        },
      ],
      stageResults: [
        {
          stage: 'code_development',
          success: true,
          confidence: 0.91,
          summary: 'Implementation already generated before the retry.',
          risks: [],
          retryCount: 0,
          artifacts: [],
          timestamp: new Date('2026-04-12T00:00:00.000Z'),
        },
      ],
      humanConfirmations: [],
      constraintsValidated: true,
      constraintCheckStatus: 'pass',
      tddEligible: true,
      redTestConfirmed: true,
      currentLoopState: 'retrying_execution',
      executionRetryCount: 1,
      lastReliablePoint: 'test_result_recorded',
      artifacts: {
        sessionDir,
        repoRootPath: dir,
        workspaceMode: 'current',
        workspacePath: dir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
        greenTestResultPath: join(sessionDir, 'tdd', 'green-test-result.json'),
      },
    }

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    await stateManager.saveLoopSession(session)
    writeFileSync(join(dir, 'resume-ok.flag'), 'ok', 'utf-8')

    let executorCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            return '# Stage Report\n\nShould not be called.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(executorCalls).toBe(0)
    expect(result.result.session?.roles?.map((role) => role.roleId)).toEqual(['architect', 'developer', 'tester'])
    expect(existsSync(result.result.session!.artifacts.roleRosterPath!)).toBe(true)
    expect(result.result.session?.artifacts.roleMessagesPath).toBeTruthy()
    expect(readFileSync(session.artifacts.eventsPath, 'utf-8')).toContain('"event":"execution_retry_resumed"')
  })

  it('lists persisted loop sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-list-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n`)

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    await stateManager.saveLoopSession({
      id: 'loop-list-1',
      title: 'List me',
      goal: 'List me',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: join(dir, '.magpie', 'sessions', 'loop', 'loop-list-1'),
        eventsPath: join(dir, '.magpie', 'sessions', 'loop', 'loop-list-1', 'events.jsonl'),
        planPath: join(dir, '.magpie', 'sessions', 'loop', 'loop-list-1', 'plan.json'),
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
      },
    } as LoopSession)

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, { mode: 'list' }, ctx)

    expect(result.result.status).toBe('listed')
    expect(result.result.sessions?.map((session) => session.id)).toEqual(['loop-list-1'])
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
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn(async (messages) => {
            const prompt = String(messages.at(-1)?.content ?? '')
            if (prompt.includes('Plan project document routing for this Magpie session.')) {
              const repoRoot = prompt.match(/^Repository root: (.+)$/m)?.[1]?.trim()
              return `\`\`\`json
{
  "mode": "project_docs",
  "reasoningSources": ["${join(repoRoot || '', 'AGENTS.md')}"],
  "formalDocsRoot": "${join(repoRoot || '', 'docs', 'guides')}",
  "formalDocTargets": {
    "trd": "${join(repoRoot || '', 'docs', 'guides', 'delivery-trd.md')}"
  },
  "confidence": 0.95
}
\`\`\``
            }
            if (prompt.includes('Evaluate this stage execution quality.')) {
              return '{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"ok"}'
            }
            return actual.createConfiguredProvider(input, config as never).chat(messages)
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

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
    const documentPlan = JSON.parse(
      readFileSync(result.result.session!.artifacts.documentPlanPath!, 'utf-8')
    ) as { formalDocsRoot: string; formalDocTargets: { trd?: string } }
    const normalizedFormalDocsRoot = documentPlan.formalDocsRoot.replace(/^\/private/, '')
    const normalizedFormalTrdTarget = documentPlan.formalDocTargets.trd?.replace(/^\/private/, '')
    const normalizedWorkspacePath = result.result.session!.artifacts.workspacePath!.replace(/^\/private/, '')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.workspaceMode).toBe('worktree')
    expect(result.result.session?.artifacts.workspacePath).toContain(`${dir}/.worktrees/`)
    expect(result.result.session?.artifacts.workspacePath).not.toBe(dir)
    expect(result.result.session?.artifacts.worktreeBranch).toMatch(/^sch\//)
    expect(result.result.session?.branchName).toBe(result.result.session?.artifacts.worktreeBranch)
    expect(existsSync(join(result.result.session!.artifacts.workspacePath!, '.git'))).toBe(true)
    expect(normalizedFormalDocsRoot).toBe(join(normalizedWorkspacePath, 'docs', 'guides'))
    expect(normalizedFormalTrdTarget).toBe(join(normalizedWorkspacePath, 'docs', 'guides', 'delivery-trd.md'))
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

  it('persists runtime verification output in unit mock stage artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-unit-mock-artifact-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo unit-safe"\n      mock_test: "echo mock-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const artifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'unit_mock_test.md'), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(artifact).toContain('# Verification')
    expect(artifact).toContain('## Unit Test (echo unit-safe)')
    expect(artifact).toContain('unit-safe')
    expect(artifact).toContain('## Mock Test (echo mock-safe)')
    expect(artifact).toContain('mock-safe')
  })
})

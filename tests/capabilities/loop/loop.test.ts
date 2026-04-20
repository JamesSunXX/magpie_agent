import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { StateManager, type LoopSession } from '../../../src/core/state/index.js'
import { loopCapability } from '../../../src/capabilities/loop/index.js'
import type { ProviderBindingInput, AIProvider } from '../../../src/platform/providers/index.js'
import { loadHumanConfirmationItems, updateHumanConfirmationItem } from '../../../src/capabilities/loop/domain/human-confirmation.js'

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

const taskStatusMocks = vi.hoisted(() => ({
  publishFeishuTaskStatusFromConfig: vi.fn().mockResolvedValue(true),
}))

const providerMocks = vi.hoisted(() => ({
  factory: null as null | ((
    input: ProviderBindingInput,
    config: unknown,
    actual: typeof import('../../../src/platform/providers/index.js')
  ) => AIProvider),
  autoBranchResponse: 'branch: delivery-flow',
  autoBranchFactoryError: null as string | null,
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
    promoteKnowledgeCandidatesWithMemorySync: vi.fn(async (...args: Parameters<typeof actual.promoteKnowledgeCandidatesWithMemorySync>) => {
      if (knowledgeMocks.failPromote) {
        throw new Error('knowledge promotion failed')
      }
      return actual.promoteKnowledgeCandidatesWithMemorySync(...args)
    }),
  }
})

vi.mock('../../../src/platform/integrations/im/feishu/task-status.js', () => ({
  publishFeishuTaskStatusFromConfig: taskStatusMocks.publishFeishuTaskStatusFromConfig,
}))

vi.mock('../../../src/platform/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/platform/providers/index.js')>()
  return {
    ...actual,
    createConfiguredProvider: vi.fn((input: ProviderBindingInput, config: unknown) => {
      if (input.logicalName === 'capabilities.loop.auto_branch') {
        if (providerMocks.autoBranchFactoryError) {
          throw new Error(providerMocks.autoBranchFactoryError)
        }
        return {
          name: 'mock-auto-branch',
          chat: vi.fn().mockResolvedValue(providerMocks.autoBranchResponse),
          chatStream: vi.fn(async function * () {}),
        }
      }
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
    providerMocks.autoBranchResponse = 'branch: delivery-flow'
    providerMocks.autoBranchFactoryError = null
    taskStatusMocks.publishFeishuTaskStatusFromConfig.mockReset()
    taskStatusMocks.publishFeishuTaskStatusFromConfig.mockResolvedValue(true)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
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

  it('persists a stage handoff card and records its path on the stage result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-stage-handoff-'))
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

    const stageResult = result.result.session?.stageResults[0]
    expect(stageResult?.handoffPath).toBe(join(result.result.session!.artifacts.sessionDir, 'handoff-prd_review.json'))
    expect(stageResult?.artifacts).toContain(stageResult?.handoffPath)
    expect(stageResult?.resultType).toBe('passed')
    expect(existsSync(stageResult!.handoffPath!)).toBe(true)

    const handoff = JSON.parse(readFileSync(stageResult!.handoffPath!, 'utf-8'))
    expect(handoff).toMatchObject({
      stage: 'prd_review',
      goal: 'Complete delivery flow',
      result: 'passed',
      work_done: stageResult?.summary,
      open_risks: stageResult?.risks,
    })
    expect(handoff.next_stage).toBeUndefined()
    expect(handoff.next_input_minimum).toEqual(
      stageResult?.artifacts.filter((path): path is string => Boolean(path) && path !== stageResult?.handoffPath)
    )
    expect(handoff.evidence_refs).toEqual(
      stageResult?.artifacts.filter((path): path is string => Boolean(path) && path !== stageResult?.handoffPath)
    )
  })

  it('uses the 9-stage default runtime sequence when loop stages are not configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-default-stages-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    expect(result.result.session?.stages).toEqual([
      'prd_review',
      'domain_partition',
      'trd_generation',
      'dev_preparation',
      'red_test_confirmation',
      'implementation',
      'green_fixup',
      'unit_mock_test',
      'integration_test',
    ])
    expect(result.result.session?.stages).not.toContain('code_development')
  })

  it('keeps distinct handoff cards when the same stage appears more than once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-stage-handoff-repeat-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review, prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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

    const handoffPaths = result.result.session?.stageResults
      .map((stageResult) => stageResult.handoffPath)
      .filter((path): path is string => Boolean(path)) || []

    expect(handoffPaths).toEqual([
      join(result.result.session!.artifacts.sessionDir, 'handoff-prd_review.json'),
      join(result.result.session!.artifacts.sessionDir, 'handoff-prd_review-2.json'),
    ])
    expect(new Set(handoffPaths).size).toBe(2)
    expect(handoffPaths.every((path) => existsSync(path))).toBe(true)

    const firstHandoff = JSON.parse(readFileSync(handoffPaths[0]!, 'utf-8'))
    const secondHandoff = JSON.parse(readFileSync(handoffPaths[1]!, 'utf-8'))
    expect(firstHandoff.next_stage).toBe('prd_review')
    expect(secondHandoff.next_stage).toBeUndefined()
  })

  it('resumes a legacy code_development session even when the saved plan is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-legacy-resume-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const plannerModule = await vi.importActual<typeof import('../../../src/capabilities/loop/domain/planner.js')>(
      '../../../src/capabilities/loop/domain/planner.js'
    )
    plannerMocks.generateLoopPlan.mockImplementationOnce((...args) => plannerModule.generateLoopPlan(...args))

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('not-json'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    const sessionId = 'loop-legacy-resume'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    mkdirSync(sessionDir, { recursive: true })

    const session: LoopSession = {
      id: sessionId,
      title: 'Legacy resume',
      goal: 'Complete delivery flow',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development' as never],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      lastReliablePoint: 'constraints_validated',
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: join(sessionDir, 'human_confirmation.md'),
      },
    }
    await stateManager.saveLoopSession(session)

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.plan).toHaveLength(1)
    expect(result.result.session?.plan[0]).toMatchObject({
      stage: 'code_development',
      title: 'Implementation',
    })
    expect(result.result.session?.stageResults[0]?.stage).toBe('code_development')
  })

  it('publishes a Feishu task status update when a loop task completes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-feishu-status-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n  im:\n    enabled: true\n    default_provider: feishu_main\n    providers:\n      feishu_main:\n        type: feishu-app\n        app_id: app-id\n        app_secret: app-secret\n        verification_token: verify-token\n        default_chat_id: oc_chat\n        approval_whitelist_open_ids: [ou_operator]\n`, 'utf-8')

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
    expect(taskStatusMocks.publishFeishuTaskStatusFromConfig).toHaveBeenCalledWith(
      dir,
      expect.any(Object),
      expect.objectContaining({
        capability: 'loop',
        sessionId: result.result.session!.id,
        status: 'completed',
        title: 'Complete delivery flow',
      })
    )
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

  it('falls back to kiro when the codex executor times out during a stage', async () => {
    const codexExecutorChat = vi.fn().mockRejectedValue(new Error('Codex CLI timed out after 1800s'))
    const kiroExecutorChat = vi.fn().mockResolvedValue('# Stage Report\n\nTRD generated.\n\n## Artifacts\n- /tmp/generated-trd.md')

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: input.tool === 'kiro' || input.model === 'kiro' ? 'kiro' : 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        if (input.tool === 'kiro' || input.model === 'kiro') {
          return {
            name: 'kiro',
            chat: kiroExecutorChat,
            chatStream: vi.fn(async function * () {}),
          }
        }
        return {
          name: 'codex',
          chat: codexExecutorChat,
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-codex-executor-fallback-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nGenerate a TRD.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  codex:\n    enabled: true\n  kiro:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: codex\n    stages: [trd_generation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Generate TRD with fallback',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(codexExecutorChat).toHaveBeenCalledTimes(1)
    expect(kiroExecutorChat).toHaveBeenCalledTimes(1)
    expect(events).toContain('"event":"provider_fallback_applied"')
    expect(events).toContain('"from":"codex"')
    expect(events).toContain('"to":"kiro"')
    expect(events).toContain('"reason":"Codex CLI timed out after 1800s"')
  })

  it('falls back to kiro when the codex planner times out during stage evaluation', async () => {
    const codexPlannerChat = vi.fn().mockRejectedValue(new Error('Codex CLI timed out after 1800s'))
    const kiroPlannerChat = vi.fn().mockResolvedValue('{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage ok."}')

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        if (input.tool === 'kiro' || input.model === 'kiro') {
          return {
            name: 'kiro',
            chat: kiroPlannerChat,
            chatStream: vi.fn(async function * () {}),
          }
        }
        return {
          name: 'codex',
          chat: codexPlannerChat,
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nTRD generated.\n\n## Artifacts\n- /tmp/generated-trd.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-codex-planner-fallback-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nGenerate a TRD.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  codex:\n    enabled: true\n  kiro:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: codex\n    executor_model: mock\n    stages: [trd_generation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Evaluate TRD with fallback',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(codexPlannerChat.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(kiroPlannerChat).toHaveBeenCalledTimes(1)
    expect(events).toContain('"event":"provider_fallback_applied"')
    expect(events).toContain('"role":"planner"')
    expect(events).toContain('"reason":"Codex CLI timed out after 1800s"')
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
        stage: 'implementation',
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

    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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

  it('publishes human confirmation into a Feishu thread when im integration is enabled', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":["Needs human"],"requireHumanConfirmation":true,"summary":"Explicit human confirmation required."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName.startsWith('reviewers.')) {
        throw new Error('model reviewers should not run when evaluation requires human confirmation')
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-feishu-human-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_root' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-2',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply_1' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 1\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\nintegrations:\n  notifications:\n    enabled: false\n  im:\n    enabled: true\n    default_provider: feishu_main\n    providers:\n      feishu_main:\n        type: feishu-app\n        app_id: app-id\n        app_secret: app-secret\n        verification_token: verify-token\n        default_chat_id: oc_chat\n        approval_whitelist_open_ids:\n          - ou_operator\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('paused')
    expect(fetchMock).toHaveBeenCalledTimes(4)

    const mapping = readFileSync(join(dir, '.magpie', 'im', 'thread-mappings.json'), 'utf-8')
    expect(mapping).toContain('"sessionId"')
    expect(mapping).toContain('"chatId": "oc_chat"')
  })

  it('confirms a red test before code development for TDD-eligible tasks', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'implementation',
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
        stage: 'implementation',
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "magpie-command-that-does-not-exist"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    expect(result.result.session?.reworkOrigin).toBe('implementation')
    expect(result.result.session?.executionRetryCount).toBe(1)
    expect(result.result.session?.lastFailureReason).toContain('Red test could not be established')
    expect(events).toContain('"event":"red_test_execution_retry_required"')
  })

  it('automatically retries a failed quality fix before pausing the loop', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'implementation',
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    let executorCalls = 0
    let rescueCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            return '# Stage Report\n\nPrepared code development output.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.stage_rescue.implementation') {
        return {
          name: 'mock-rescue',
          chat: vi.fn(async () => {
            rescueCalls += 1
            writeFileSync(join(dir, 'ready.flag'), 'ready', 'utf-8')
            return '# Rescue Report\n\nApplied the quality fix.\n'
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
    expect(executorCalls).toBe(2)
    expect(rescueCalls).toBe(1)
  })

  it('pauses with revising state when post-implementation tests still fail', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'implementation',
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'process.exit(process.env.RED_PHASE === "1" ? 1 : 1)\n', 'utf-8')

    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.stage_rescue.implementation') {
        return {
          name: 'mock-rescue',
          chat: vi.fn(async () => '# Rescue Report\n\nAttempted repair.\n'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
      stages: ['implementation'],
      plan: [
        {
          id: 'task-1',
          stage: 'implementation',
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

  it('resumes a failed code development session when the checkpoint is still recoverable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-resume-failed-red-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'const fs = require("fs"); process.exit(fs.existsSync("ready.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-resume-failed-red'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    const eventsPath = join(sessionDir, 'events.jsonl')
    const planPath = join(sessionDir, 'plan.json')
    const redTestResultPath = join(sessionDir, 'tdd', 'red-test-result.json')
    const tddTargetPath = join(sessionDir, 'tdd', 'target.md')
    const nextRoundInputPath = join(sessionDir, 'role-rounds', 'round-1-next.md')
    mkdirSync(join(sessionDir, 'tdd'), { recursive: true })
    mkdirSync(join(sessionDir, 'role-rounds'), { recursive: true })
    writeFileSync(eventsPath, '', 'utf-8')
    writeFileSync(planPath, JSON.stringify([], null, 2), 'utf-8')
    writeFileSync(tddTargetPath, '# TDD Target\n\n- Keep formatter behavior stable.\n', 'utf-8')
    writeFileSync(nextRoundInputPath, '# Next Round\n\nContinue from the existing workspace.\n', 'utf-8')
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
      title: 'Resume failed session from red test',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'failed',
      currentStageIndex: 0,
      stages: ['implementation'],
      plan: [
        {
          id: 'task-1',
          stage: 'implementation',
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
      currentLoopState: 'blocked_for_human',
      lastReliablePoint: 'red_test_confirmed',
      lastFailureReason: '实现后测试仍失败：继续从当前工作区修复。',
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
        nextRoundInputPath,
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
    expect(result.result.session?.status).toBe('completed')
    expect(result.result.session?.lastReliablePoint).toBe('completed')
    expect(executorCalls).toBe(1)
  })

  it('resumes a failed unit mock test stage when the rerun checkpoint is still recoverable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-resume-failed-unit-mock-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation, unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo unit-safe"\n      mock_test: "echo mock-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-resume-failed-unit-mock'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    const eventsPath = join(sessionDir, 'events.jsonl')
    const planPath = join(sessionDir, 'plan.json')
    const nextRoundInputPath = join(sessionDir, 'role-rounds', 'round-2-next.md')
    mkdirSync(join(sessionDir, 'role-rounds'), { recursive: true })
    writeFileSync(eventsPath, '', 'utf-8')
    writeFileSync(planPath, JSON.stringify([], null, 2), 'utf-8')
    writeFileSync(nextRoundInputPath, '# Next Round\n\nRerun the verification stage after the mock fix.\n', 'utf-8')

    const session: LoopSession = {
      id: sessionId,
      title: 'Resume failed unit mock stage',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:10:00.000Z'),
      status: 'failed',
      currentStageIndex: 1,
      stages: ['implementation', 'unit_mock_test'],
      plan: [
        {
          id: 'task-1',
          stage: 'implementation',
          title: 'Implement formatter',
          description: 'Implement a pure formatter for checkout amounts',
          dependencies: [],
          successCriteria: ['Formatter output matches the spec'],
        },
        {
          id: 'task-2',
          stage: 'unit_mock_test',
          title: 'Run verification',
          description: 'Run unit and mock verification',
          dependencies: ['task-1'],
          successCriteria: ['Verification succeeds'],
        },
      ],
      stageResults: [{
        stage: 'implementation',
        success: true,
        confidence: 0.8,
        summary: 'Implementation completed.',
        risks: [],
        retryCount: 0,
        artifacts: [join(sessionDir, 'implementation.md')],
        timestamp: new Date('2026-04-12T00:05:00.000Z'),
      }, {
        stage: 'unit_mock_test',
        success: false,
        confidence: 0.4,
        summary: 'Mock tests failed and need another pass.',
        risks: ['rerun after fixing the failing mock setup'],
        retryCount: 0,
        artifacts: [join(sessionDir, 'unit_mock_test.md')],
        timestamp: new Date('2026-04-12T00:09:00.000Z'),
      }],
      humanConfirmations: [],
      constraintsValidated: true,
      constraintCheckStatus: 'pass',
      lastReliablePoint: 'constraints_validated',
      artifacts: {
        sessionDir,
        repoRootPath: dir,
        workspaceMode: 'current',
        workspacePath: dir,
        eventsPath,
        planPath,
        humanConfirmationPath: join(dir, 'human_confirmation.md'),
        nextRoundInputPath,
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
            return '# Stage Report\n\nVerification rerun completed.\n'
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
    expect(result.result.session?.status).toBe('completed')
    expect(result.result.session?.currentStageIndex).toBe(2)
    expect(result.result.session?.lastReliablePoint).toBe('completed')
    expect(executorCalls).toBe(1)
  })

  it('blocks resume when the saved checkpoint is not a complete reliable point', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-invalid-checkpoint-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
      stages: ['implementation'],
      plan: [
        {
          id: 'task-1',
          stage: 'implementation',
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

  it('continues to the next stage after an approved human confirmation instead of rerunning the approved stage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-approved-human-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review, domain_partition]\n    confidence_threshold: 0\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const sessionId = 'loop-approved-human'
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', sessionId)
    const eventsPath = join(sessionDir, 'events.jsonl')
    const planPath = join(sessionDir, 'plan.json')
    const stageArtifactPath = join(sessionDir, 'prd_review.md')
    const humanConfirmationPath = join(dir, 'human_confirmation.md')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(eventsPath, '', 'utf-8')
    writeFileSync(planPath, JSON.stringify([], null, 2), 'utf-8')
    writeFileSync(stageArtifactPath, '# Stage Report\n\nAlready approved.\n', 'utf-8')
    writeFileSync(humanConfirmationPath, `# Human Confirmation Queue\n\n<!-- MAGPIE_HUMAN_CONFIRMATION_START -->\n\n\`\`\`yaml\nid: hc-1\nsession_id: ${sessionId}\nstage: prd_review\nstatus: approved\ndecision: approved\nrationale: Resume without rerunning the approved stage.\nreason: Reviewed manually.\nartifacts:\n  - ${stageArtifactPath}\nnext_action: Continue to the next stage\ncreated_at: 2026-04-12T00:00:00.000Z\nupdated_at: 2026-04-12T00:05:00.000Z\n\`\`\`\n<!-- MAGPIE_HUMAN_CONFIRMATION_END -->\n`, 'utf-8')

    const session: LoopSession = {
      id: sessionId,
      title: 'Resume after approval',
      goal: 'Add amount formatter utility',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:05:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['prd_review', 'domain_partition'],
      plan: [
        {
          id: 'task-1',
          stage: 'prd_review',
          title: 'Review the PRD',
          description: 'Review the PRD before implementation',
          dependencies: [],
          successCriteria: ['Review notes captured'],
        },
        {
          id: 'task-2',
          stage: 'domain_partition',
          title: 'Partition the domain',
          description: 'Split the work into domain pieces',
          dependencies: ['task-1'],
          successCriteria: ['Domain plan written'],
        },
      ],
      stageResults: [
        {
          stage: 'prd_review',
          success: true,
          confidence: 0.2,
          summary: 'Reviewed but required manual confirmation.',
          risks: ['Needs explicit approval to continue.'],
          retryCount: 0,
          artifacts: [stageArtifactPath],
          timestamp: new Date('2026-04-12T00:04:00.000Z'),
        },
      ],
      humanConfirmations: [
        {
          id: 'hc-1',
          sessionId,
          stage: 'prd_review',
          status: 'pending',
          decision: 'pending',
          rationale: '',
          reason: 'Reviewed manually.',
          artifacts: [stageArtifactPath],
          nextAction: 'Review risk and approve to continue',
          createdAt: new Date('2026-04-12T00:00:00.000Z'),
          updatedAt: new Date('2026-04-12T00:00:00.000Z'),
        },
      ],
      lastReliablePoint: 'completed',
      artifacts: {
        sessionDir,
        repoRootPath: dir,
        workspaceMode: 'current',
        workspacePath: dir,
        eventsPath,
        planPath,
        humanConfirmationPath,
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
            return '# Stage Report\n\nGenerated domain partition.\n'
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

    const resumedConfirmation = result.result.session?.humanConfirmations[0]

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.currentStageIndex).toBe(2)
    expect(executorCalls).toBe(1)
    expect(resumedConfirmation).toMatchObject({
      status: 'approved',
      decision: 'approved',
      rationale: 'Resume without rerunning the approved stage.',
    })
    expect(readFileSync(eventsPath, 'utf-8')).toContain('"event":"human_confirmation_applied"')
  })

  it('consumes the execution retry budget before pausing for human help', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'implementation',
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node runner.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n    model: mock\n    prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node runner.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
      stages: ['implementation'],
      plan: [
        {
          id: 'task-1',
          stage: 'implementation',
          title: 'Add amount formatter utility',
          description: 'Implement a pure formatter for checkout amounts',
          dependencies: [],
          successCriteria: ['Formatter output matches the spec'],
        },
      ],
      stageResults: [
        {
          stage: 'implementation',
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

  it('uses the AI-generated branch slug and keeps the timestamp suffix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-13T05:47:26.000Z'))
    providerMocks.autoBranchResponse = 'branch: admin-cancel-audit-sync'

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-ai-branch-'))
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/"\n    branch_naming:\n      enabled: true\n      tool: claw\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBe('sch/admin-cancel-audit-sync-2026-04-13-05-47-26')
    expect(currentBranch).toBe('sch/admin-cancel-audit-sync-2026-04-13-05-47-26')
    expect(events).toContain('"event":"auto_branch_named"')
    expect(events).toContain('"source":"ai"')
  })

  it('falls back to a rule-based branch slug when the AI branch name is unusable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-13T05:47:26.000Z'))
    providerMocks.autoBranchResponse = '这里不是分支名'

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-fallback-branch-'))
    mkdirSync(join(dir, 'docs', 'current', 'admin_backend'), { recursive: true })

    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "bot"', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'README.md'), '# temp repo\n', 'utf-8')
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })

    const prdPath = join(dir, 'docs', 'current', 'admin_backend', 'PRD.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/"\n    branch_naming:\n      enabled: true\n      tool: claw\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBe('sch/admin-backend-2026-04-13-05-47-26')
    expect(events).toContain('"event":"auto_branch_named"')
    expect(events).toContain('"source":"fallback"')
    expect(events).toContain('"reason":"invalid_slug"')
  })

  it('falls back to a non-AI semantic branch name when branch naming provider setup fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-13T05:47:26.000Z'))
    providerMocks.autoBranchFactoryError = 'Unknown tool: nope'

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-bad-branch-tool-'))
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/"\n    branch_naming:\n      enabled: true\n      tool: nope\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBe('sch/sample-prd-2026-04-13-05-47-26')
    expect(events).toContain('"event":"auto_branch_naming_degraded"')
    expect(events).toContain('"reason":"Unknown tool: nope"')
    expect(events).toContain('"source":"fallback"')
  })

  it('uses the legacy timestamp-only branch name when semantic branch naming is disabled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-13T05:47:26.000Z'))

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-legacy-branch-'))
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
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/"\n    branch_naming:\n      enabled: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBe('sch/2026-04-13-05-47-26')
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

  it('disables auto-commit when the workspace is not a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-no-git-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'pending-change.txt'), 'should stay uncommitted\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: true\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.branchName).toBeUndefined()
    expect(events).toContain('"event":"auto_commit_disabled"')
    expect(events).toContain('"reason":"branch_creation_failed"')
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

  it('creates and auto-ignores a worktree directory for complex runs when the repository has none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-worktree-missing-'))
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

    const excludePath = execSync('git rev-parse --git-path info/exclude', { cwd: dir, encoding: 'utf-8' }).trim()
    const excludeContent = readFileSync(join(dir, excludePath), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.workspaceMode).toBe('worktree')
    expect(existsSync(join(dir, '.worktrees'))).toBe(true)
    expect(excludeContent).toContain('.worktrees/')
  })

  it('auto-ignores the worktree directory for complex runs when the directory exists but is not ignored', async () => {
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

    const excludePath = execSync('git rev-parse --git-path info/exclude', { cwd: dir, encoding: 'utf-8' }).trim()
    const excludeContent = readFileSync(join(dir, excludePath), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.workspaceMode).toBe('worktree')
    expect(excludeContent).toContain('.worktrees/')
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

  it('runs configured unit mock verification steps when provided', async () => {
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
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nVerified unit mock stage.\n'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-custom-unit-mock-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_mock_test_steps:\n        - label: "Java Unit Tests"\n          command: "echo java-safe"\n        - label: "Shared Mock Checks"\n          command: "echo mock-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    expect(artifact).toContain('## Java Unit Tests (echo java-safe)')
    expect(artifact).toContain('java-safe')
    expect(artifact).toContain('## Shared Mock Checks (echo mock-safe)')
    expect(artifact).toContain('mock-safe')
  })

  it('skips the legacy default mock target when no matching tests exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-legacy-mock-target-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'mock-target-repro',
      private: true,
      scripts: {
        'test:run': 'node mock-runner.js',
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(dir, 'mock-runner.js'), [
      "if (process.argv.includes('tests/mock')) {",
      "  console.error('No test files found, exiting with code 1')",
      "  process.exit(1)",
      "}",
      "console.log('unit-safe')",
    ].join('\n'), 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo unit-safe"\n      mock_test: "npm run test:run -- tests/mock"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    expect(artifact).toContain('## Mock Test ((skipped: no matching tests))')
    expect(artifact).toContain('Skipped: no matching tests for legacy default mock target.')
  })

  it('prefers configured unit mock verification steps over legacy commands', async () => {
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
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nVerified unit mock stage.\n'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-custom-unit-mock-priority-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node -e \\"process.exit(1)\\""\n      mock_test: "node -e \\"process.exit(1)\\""\n      unit_mock_test_steps:\n        - label: "Shared Verification"\n          command: "echo shared-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

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
    expect(artifact).toContain('## Shared Verification (echo shared-safe)')
    expect(artifact).toContain('shared-safe')
    expect(artifact).not.toContain('process.exit(1)')
    expect(artifact).not.toContain('## Unit Test (')
    expect(artifact).not.toContain('## Mock Test (')
    expect(artifact).not.toContain('Skipped: no matching tests for legacy default mock target.')
  })

  it('does not pause for human review when unit mock verification succeeds with an expected legacy mock skip', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue(JSON.stringify({
            confidence: 0.2,
            risks: ['Mock test was skipped.'],
            requireHumanConfirmation: true,
            summary: 'Verification looked incomplete.',
          })),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nVerified unit mock stage.\n'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-mock-skip-no-pause-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'mock-skip-no-pause',
      private: true,
      scripts: {
        'test:run': 'node mock-runner.js',
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(dir, 'mock-runner.js'), [
      "if (process.argv.includes('tests/mock')) {",
      "  console.error('No test files found, exiting with code 1')",
      "  process.exit(1)",
      "}",
      "console.log('unit-safe')",
    ].join('\n'), 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.78\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "exception_or_low_confidence"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo unit-safe"\n      mock_test: "npm run test:run -- tests/mock"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Verify unit and mock tests',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.status).toBe('completed')
    expect(existsSync(join(dir, 'human_confirmation.md'))).toBe(false)
  })

  it('uses the default e2e target for integration tests when no integration command is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-default-integration-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'integration-target-repro',
      private: true,
      scripts: {
        'test:run': 'node integration-runner.js',
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(dir, 'integration-runner.js'), [
      "if (process.argv.includes('tests/integration')) {",
      "  console.error('missing integration target')",
      "  process.exit(1)",
      "}",
      "if (process.argv.includes('tests/e2e')) {",
      "  console.log('e2e-safe')",
      "  process.exit(0)",
      "}",
      "console.error('unexpected test target')",
      "process.exit(1)",
    ].join('\n'), 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [integration_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "echo unit-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const artifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'integration_test.md'), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(artifact).toContain('## Integration Test (npm run test:run -- tests/e2e)')
    expect(artifact).toContain('e2e-safe')
  })

  it('replaces model-generated verification sections with the runtime integration evidence', async () => {
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
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue([
            '# integration_test 阶段报告',
            '',
            '## 结果',
            '- 当前阶段通过。',
            '',
            '# Verification',
            '',
            '## Integration Test (npm run test:run -- tests/integration)',
            'stale verification should not survive',
          ].join('\n')),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-integration-sanitize-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'integration-sanitize-repro',
      private: true,
      scripts: {
        'test:run': 'node integration-runner.js',
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(dir, 'integration-runner.js'), [
      "if (process.argv.includes('tests/e2e')) {",
      "  console.log('e2e-safe')",
      "  process.exit(0)",
      "}",
      "console.error('unexpected test target')",
      "process.exit(1)",
    ].join('\n'), 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [integration_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const artifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'integration_test.md'), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(artifact).toContain('## Integration Test (npm run test:run -- tests/e2e)')
    expect(artifact).toContain('e2e-safe')
    expect(artifact).not.toContain('tests/integration')
    expect(artifact).not.toContain('stale verification should not survive')
    expect((artifact.match(/^# Verification$/gm) || [])).toHaveLength(1)
  })

  it('keeps model-written verification notes when replacing runtime verification output', async () => {
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
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue([
            '# integration_test 阶段报告',
            '',
            '## 结果',
            '- 当前阶段通过。',
            '',
            '# Verification',
            '',
            '- 这里是模型写的说明，不是运行出来的测试结果。',
            '',
            '## 下一步',
            '- 继续观察发布结果。',
          ].join('\n')),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-integration-keep-notes-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'integration-keep-notes',
      private: true,
      scripts: {
        'test:run': 'node integration-runner.js',
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(dir, 'integration-runner.js'), [
      "if (process.argv.includes('tests/e2e')) {",
      "  console.log('e2e-safe')",
      "  process.exit(0)",
      "}",
      "console.error('unexpected test target')",
      "process.exit(1)",
    ].join('\n'), 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [integration_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const artifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'integration_test.md'), 'utf-8')

    expect(result.result.status).toBe('completed')
    expect(artifact).toContain('- 这里是模型写的说明，不是运行出来的测试结果。')
    expect(artifact).toContain('## 下一步')
    expect(artifact).toContain('## Integration Test (npm run test:run -- tests/e2e)')
    expect(artifact).toContain('e2e-safe')
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

  it('keeps failed unit mock verification resumable instead of marking the loop failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-unit-mock-resumable-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node -e \\"process.exit(1)\\""\n      mock_test: "echo mock-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(result.result.session?.currentLoopState).toBe('revising')
    expect(result.result.session?.reworkOrigin).toBe('verification')
    expect(result.result.session?.currentStageIndex).toBe(0)
    expect(result.result.session?.stageResults.at(-1)?.stage).toBe('unit_mock_test')
    expect(result.result.session?.stageResults.at(-1)?.success).toBe(false)
    expect(result.result.session?.stageResults.at(-1)?.resultType).toBe('rework')
    expect(result.result.session?.artifacts.nextRoundInputPath).toBeTruthy()
    expect(existsSync(result.result.session!.artifacts.humanConfirmationPath)).toBe(false)
    expect(events).not.toContain('"event":"stage_failed"')
    expect(events).not.toContain('"event":"human_confirmation_required"')

    const stateManager = new StateManager(dir)
    const persisted = await stateManager.loadLoopSession(result.result.session!.id)
    expect(persisted?.reworkOrigin).toBe('verification')

    const resumed = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId: result.result.session!.id,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(resumed.result.status).toBe('paused')
    expect(resumed.result.session?.currentStageIndex).toBe(0)
    expect(resumed.result.session?.reworkOrigin).toBe('verification')
    expect(resumed.result.session?.stageResults.at(-1)?.stage).toBe('unit_mock_test')
  })

  it('keeps failed integration verification resumable on the integration stage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-integration-resumable-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [integration_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      integration_test: "node -e \\"process.exit(1)\\""\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(result.result.session?.currentLoopState).toBe('revising')
    expect(result.result.session?.reworkOrigin).toBe('integration')
    expect(result.result.session?.currentStageIndex).toBe(0)
    expect(result.result.session?.stageResults.at(-1)?.stage).toBe('integration_test')
    expect(result.result.session?.stageResults.at(-1)?.success).toBe(false)
    expect(result.result.session?.stageResults.at(-1)?.resultType).toBe('rework')
  })

  it('uses the current stage rescue binding for implementation repair retries', async () => {
    plannerMocks.generateLoopPlan.mockResolvedValueOnce([
      {
        id: 'task-1',
        stage: 'implementation',
        title: 'Add amount formatter utility',
        description: 'Implement a pure formatter for checkout amounts',
        dependencies: [],
        successCriteria: ['Formatter output matches the spec'],
      },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-stage-rescue-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, '.magpie'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(prdPath, '# PRD\n\nAmount formatter utility.', 'utf-8')
    writeFileSync(join(dir, 'script.js'), 'const fs = require("fs"); process.exit(fs.existsSync("ready.flag") ? 0 : 1)\n', 'utf-8')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\n  kiro:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [implementation]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node script.js"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    let executorCalls = 0
    let rescueCalls = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            executorCalls += 1
            return '# Stage Report\n\nPrepared code development output.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.stage_rescue.implementation') {
        return {
          name: 'mock-rescue',
          chat: vi.fn(async () => {
            rescueCalls += 1
            writeFileSync(join(dir, 'ready.flag'), 'ready', 'utf-8')
            return '# Rescue Report\n\nApplied a focused repair.\n'
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
    expect(executorCalls).toBe(2)
    expect(rescueCalls).toBeGreaterThan(0)
  })

  it('writes a workflow_defect failure record when resume checkpoint validation fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-resume-failure-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [implementation]\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    const sessionDir = join(dir, '.magpie', 'sessions', 'loop', 'loop-resume-bad')
    mkdirSync(sessionDir, { recursive: true })
    await stateManager.saveLoopSession({
      id: 'loop-resume-bad',
      title: 'Loop resume failure',
      goal: 'Resume loop safely',
      prdPath,
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'running',
      currentStageIndex: 0,
      stages: ['implementation'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      constraintsValidated: true,
      redTestConfirmed: true,
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: join(sessionDir, 'human_confirmation.md'),
      },
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'resume',
      sessionId: 'loop-resume-bad',
      waitHuman: false,
    }, ctx)

    const failureDir = join(sessionDir, 'failures')
    const failureFiles = readdirSync(failureDir)
    const failure = JSON.parse(readFileSync(join(failureDir, failureFiles[0]!), 'utf-8')) as {
      category: string
      reason: string
    }

    expect(result.result.status).toBe('paused')
    expect(failure.category).toBe('workflow_defect')
    expect(failure.reason).toContain('no reliable checkpoint')
  })

  it('keeps failed unit mock verification resumable after human approval to continue', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":["Hand results back to the developer provider."],"requireHumanConfirmation":true,"summary":"Verification still needs another provider pass."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-unit-mock-human-approve-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    planner_agent: kiro_planner\n    executor_model: mock\n    stages: [unit_mock_test]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 5\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "always"\n      poll_interval_sec: 1\n    commands:\n      unit_test: "node -e \\"process.exit(1)\\""\n      mock_test: "echo mock-safe"\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const confirmationPath = join(dir, 'human_confirmation.md')
    const approvePendingConfirmation = (async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (existsSync(confirmationPath)) {
          const items = await loadHumanConfirmationItems(confirmationPath)
          const pending = items.find((item) => item.decision === 'pending')
          if (pending) {
            await updateHumanConfirmationItem(confirmationPath, pending.id, {
              decision: 'approved',
              status: 'approved',
              updatedAt: new Date(),
            })
            return
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('Timed out waiting for loop human confirmation file.')
    })()

    const [result] = await Promise.all([
      runCapability(loopCapability, {
        mode: 'run',
        goal: 'Complete delivery flow',
        prdPath,
        waitHuman: true,
        dryRun: false,
      }, ctx),
      approvePendingConfirmation,
    ])

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')

    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(result.result.session?.currentLoopState).toBe('revising')
    expect(result.result.session?.stageResults.at(-1)?.stage).toBe('unit_mock_test')
    expect(result.result.session?.stageResults.at(-1)?.success).toBe(false)
    expect(result.result.session?.artifacts.nextRoundInputPath).toBeTruthy()
    expect(events).toContain('"event":"human_confirmation_required"')
    expect(events).not.toContain('"event":"stage_failed"')
  })

  it('writes a failure record when a stage crashes', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.5,"risks":["boom"],"requireHumanConfirmation":false,"summary":"stage failed"}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn(async () => {
            throw new Error('stage executor crashed hard')
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-stage-failure-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Crash the stage',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const failureDir = join(result.result.session!.artifacts.sessionDir, 'failures')
    const failureFiles = readdirSync(failureDir)
    const failure = JSON.parse(readFileSync(join(failureDir, failureFiles[0]!), 'utf-8')) as {
      category: string
      reason: string
    }

    expect(result.result.status).toBe('failed')
    expect(failure.category).toBe('unknown')
    expect(failure.reason).toContain('stage executor crashed hard')
  })

  it('uses multi-model confirmation instead of human confirmation for low-confidence stages', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.2,"risks":["Need review"],"requireHumanConfirmation":false,"summary":"Needs confirmation."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted with some risk.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'reviewers.reviewer-a' || input.logicalName === 'reviewers.reviewer-b') {
        return {
          name: String(input.logicalName),
          chat: vi.fn().mockResolvedValue('{"decision":"approved","rationale":"Looks safe.","required_actions":[]}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-model-gate-approve-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const sessionDir = result.result.session!.artifacts.sessionDir
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    expect(result.result.status).toBe('completed')
    expect(existsSync(result.result.session!.artifacts.humanConfirmationPath)).toBe(false)
    expect(existsSync(join(sessionDir, 'model_gate_prd_review_1.json'))).toBe(true)
    expect(events).toContain('"event":"model_confirmation_started"')
    expect(events).toContain('"event":"model_confirmation_completed"')
    expect(events).not.toContain('"event":"human_confirmation_required"')
  })

  it('re-runs the stage with model revision guidance without consuming execution retries', async () => {
    const executorPrompts: string[] = []
    const reviewerCallCounts = new Map<string, number>()
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        const responses = [
          '{"confidence":0.2,"risks":["Need review"],"requireHumanConfirmation":false,"summary":"Needs confirmation."}',
          '{"confidence":0.2,"risks":["Need review"],"requireHumanConfirmation":false,"summary":"Needs confirmation after revision."}',
        ]
        let index = 0
        return {
          name: 'mock-planner',
          chat: vi.fn().mockImplementation(async () => responses[Math.min(index++, responses.length - 1)]),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (
        input.logicalName === 'capabilities.loop.executor'
        || input.logicalName === 'capabilities.loop.stage_rescue.prd_review'
      ) {
        return {
          name: String(input.logicalName),
          chat: vi.fn().mockImplementation(async (messages) => {
            executorPrompts.push(String(messages.at(-1)?.content ?? ''))
            return '# Stage Report\n\nCompleted with some risk.\n\n## Artifacts\n- /tmp/generated.md'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'reviewers.reviewer-a' || input.logicalName === 'reviewers.reviewer-b') {
        return {
          name: String(input.logicalName),
          chat: vi.fn().mockImplementation(async () => {
            const key = String(input.logicalName)
            const calls = (reviewerCallCounts.get(key) || 0) + 1
            reviewerCallCounts.set(key, calls)
            if (calls === 1) {
              return '{"decision":"revise","rationale":"Need a clearer rollback note.","required_actions":["Add a rollback note."]}'
            }
            return '{"decision":"approved","rationale":"Rollback note is present.","required_actions":[]}'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-model-gate-revise-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const gateArtifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'model_gate_prd_review_2.json'), 'utf-8')
    expect(result.result.status).toBe('completed')
    expect(result.result.session?.stageResults[0]?.retryCount).toBe(0)
    expect(executorPrompts).toHaveLength(2)
    expect(executorPrompts[1]).toContain('Add a rollback note.')
    expect(gateArtifact).toContain('"decision": "approved"')
  })

  it('uses the arbitrator for conflicting model decisions and escalates to human when required', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.2,"risks":["Need review"],"requireHumanConfirmation":false,"summary":"Needs confirmation."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted with some risk.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'reviewers.reviewer-a') {
        return {
          name: 'reviewers.reviewer-a',
          chat: vi.fn().mockResolvedValue('{"decision":"approved","rationale":"Looks safe.","required_actions":[]}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'reviewers.reviewer-b') {
        return {
          name: 'reviewers.reviewer-b',
          chat: vi.fn().mockResolvedValue('{"decision":"revise","rationale":"Not enough rollback detail.","required_actions":["Add rollback detail."]}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'summarizer') {
        return {
          name: 'summarizer',
          chat: vi.fn().mockResolvedValue('{"decision":"human_required","rationale":"Risk is too high for auto-approval.","required_actions":["Get a human to confirm."]}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-model-gate-arbitrator-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 1\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const gateArtifact = readFileSync(join(result.result.session!.artifacts.sessionDir, 'model_gate_prd_review_1.json'), 'utf-8')
    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    expect(result.result.status).toBe('paused')
    expect(result.result.session?.status).toBe('paused_for_human')
    expect(existsSync(result.result.session!.artifacts.humanConfirmationPath)).toBe(true)
    expect(gateArtifact).toContain('"arbitrator"')
    expect(events).toContain('"event":"model_confirmation_escalated_to_human"')
    expect(events).toContain('"event":"human_confirmation_required"')
  })

  it('still requires human confirmation when stage evaluation explicitly demands it under multi-model policy', async () => {
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        return {
          name: 'mock-planner',
          chat: vi.fn().mockResolvedValue('{"confidence":0.95,"risks":["Needs human"],"requireHumanConfirmation":true,"summary":"Explicit human confirmation required."}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockResolvedValue('# Stage Report\n\nCompleted.\n\n## Artifacts\n- /tmp/generated.md'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName.startsWith('reviewers.')) {
        throw new Error('model reviewers should not run when evaluation requires human confirmation')
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-model-gate-human-override-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 1\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    const events = readFileSync(result.result.session!.artifacts.eventsPath, 'utf-8')
    expect(result.result.status).toBe('paused')
    expect(existsSync(result.result.session!.artifacts.humanConfirmationPath)).toBe(true)
    expect(events).toContain('"event":"human_confirmation_required"')
    expect(events).not.toContain('"event":"model_confirmation_started"')
  })

  it('continues to the next stage when model confirmation approves a failed stage', async () => {
    const executedStages: string[] = []
    let executionCount = 0
    providerMocks.factory = (input, config, actual) => {
      if (input.logicalName === 'capabilities.loop.planner') {
        const responses = [
          '{"confidence":0.2,"risks":["Test command failed"],"requireHumanConfirmation":false,"summary":"Tests failed but may be acceptable."}',
          '{"confidence":0.95,"risks":[],"requireHumanConfirmation":false,"summary":"Stage completed cleanly."}',
        ]
        let index = 0
        return {
          name: 'mock-planner',
          chat: vi.fn().mockImplementation(async () => responses[Math.min(index++, responses.length - 1)]),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'capabilities.loop.executor') {
        return {
          name: 'mock-executor',
          chat: vi.fn().mockImplementation(async () => {
            executionCount += 1
            if (executionCount === 1) {
              executedStages.push('unit_mock_test')
              return '# Stage Report\n\nUnit test stage ran.\n\n## Artifacts\n- /tmp/unit.txt'
            }
            executedStages.push('prd_review')
            return '# Stage Report\n\nPRD review stage ran.\n\n## Artifacts\n- /tmp/prd.txt'
          }),
          chatStream: vi.fn(async function * () {}),
        }
      }
      if (input.logicalName === 'reviewers.reviewer-a' || input.logicalName === 'reviewers.reviewer-b') {
        return {
          name: String(input.logicalName),
          chat: vi.fn().mockResolvedValue('{"decision":"approved","rationale":"Failure is acceptable for autonomous continuation.","required_actions":[]}'),
          chatStream: vi.fn(async function * () {}),
        }
      }
      return actual.createConfiguredProvider(input, config as never)
    }

    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-model-gate-failed-stage-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  reviewer-a:\n    model: mock\n    prompt: review a\n  reviewer-b:\n    model: mock\n    prompt: review b\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  discuss:\n    reviewers: [reviewer-a, reviewer-b]\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [unit_mock_test, prd_review]\n    confidence_threshold: 0.9\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "multi_model"\n      poll_interval_sec: 1\n      max_model_revisions: 1\n    commands:\n      unit_test: "node -e \\"process.exit(1)\\""\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(executedStages).toEqual(['unit_mock_test', 'prd_review'])
    expect(result.result.session?.stageResults.map((stageResult) => stageResult.stage)).toEqual(['unit_mock_test', 'prd_review'])
  })

  it('lists saved loop sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-list-'))
    const stateManager = new StateManager(dir)
    await stateManager.initLoopSessions()
    await stateManager.saveLoopSession({
      id: 'loop-listed',
      title: 'Listed session',
      goal: 'Show saved sessions',
      prdPath: join(dir, 'docs', 'prd.md'),
      createdAt: new Date('2026-04-12T00:00:00.000Z'),
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
      status: 'completed',
      currentStageIndex: 0,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: join(dir, '.magpie', 'sessions', 'loop', 'loop-listed'),
        eventsPath: join(dir, '.magpie', 'sessions', 'loop', 'loop-listed', 'events.jsonl'),
        planPath: join(dir, '.magpie', 'sessions', 'loop', 'loop-listed', 'plan.json'),
        humanConfirmationPath: join(dir, '.magpie', 'sessions', 'loop', 'loop-listed', 'human_confirmation.md'),
      },
    })

    const ctx = createCapabilityContext({ cwd: dir })
    const result = await runCapability(loopCapability, { mode: 'list' }, ctx)

    expect(result.result.status).toBe('listed')
    expect(result.result.sessions?.some((session) => session.id === 'loop-listed')).toBe(true)
  })
})

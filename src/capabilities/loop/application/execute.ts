import { randomBytes } from 'crypto'
import { appendFile, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import type { CapabilityContext } from '../../../core/capability/context.js'
import type {
  HumanConfirmationItem,
  LoopSession,
  LoopStageResult,
  LoopTask,
} from '../../../core/state/index.js'
import { StateManager } from '../../../core/state/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { createProvider } from '../../../platform/providers/index.js'
import type { AIProvider, Message } from '../../../platform/providers/index.js'
import type { LoopConfig, LoopStageName } from '../../../config/types.js'
import type { NotificationEvent } from '../../../platform/integrations/notifications/types.js'
import { createNotificationRouter } from '../../../platform/integrations/notifications/factory.js'
import { extractJsonBlock } from '../../../trd/renderer.js'
import {
  appendHumanConfirmationItem,
  findHumanConfirmationDecision,
} from '../domain/human-confirmation.js'
import { generateLoopPlan } from '../domain/planner.js'
import type { LoopExecutionResult, LoopPreparedInput } from '../types.js'

const DEFAULT_STAGES: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'code_development',
  'unit_mock_test',
  'integration_test',
]

interface LoopRuntimeConfig {
  plannerModel: string
  executorModel: string
  stages: LoopStageName[]
  confidenceThreshold: number
  retriesPerStage: number
  maxIterations: number
  autoCommit: boolean
  autoBranchPrefix: string
  humanConfirmationFile: string
  pollIntervalSec: number
  gatePolicy: 'exception_or_low_confidence' | 'always' | 'manual_only'
  commands: {
    unitTest: string
    mockTest: string
    integrationTest: string
  }
}

interface StageEvaluation {
  confidence: number
  risks: string[]
  requireHumanConfirmation: boolean
  summary: string
}

interface StageRunResult {
  stageResult: LoopStageResult
  paused: boolean
  failed: boolean
}

function generateId(): string {
  return randomBytes(6).toString('hex')
}

function resolveLoopConfig(config: LoopConfig | undefined): LoopRuntimeConfig {
  return {
    plannerModel: config?.planner_model || 'claude-code',
    executorModel: config?.executor_model || 'codex',
    stages: config?.stages && config.stages.length > 0 ? config.stages : DEFAULT_STAGES,
    confidenceThreshold: config?.confidence_threshold ?? 0.78,
    retriesPerStage: config?.retries_per_stage ?? 2,
    maxIterations: config?.max_iterations ?? 30,
    autoCommit: config?.auto_commit !== false,
    autoBranchPrefix: config?.auto_branch_prefix || 'sch/',
    humanConfirmationFile: config?.human_confirmation?.file || 'human_confirmation.md',
    pollIntervalSec: config?.human_confirmation?.poll_interval_sec || 8,
    gatePolicy: config?.human_confirmation?.gate_policy || 'exception_or_low_confidence',
    commands: {
      unitTest: config?.commands?.unit_test || 'npm run test:run',
      mockTest: config?.commands?.mock_test || 'npm run test:run -- tests/mock',
      integrationTest: config?.commands?.integration_test || 'npm run test:run -- tests/integration',
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveFn => setTimeout(resolveFn, ms))
}

function parseCommandArgs(command: string): string[] {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('Command must not be empty')
  }
  if (/[|&;<>`$]/.test(trimmed)) {
    throw new Error('Unsupported shell metacharacters in command')
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  for (const ch of trimmed) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && quote !== '\'') {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (escaped || quote) {
    throw new Error('Unterminated command quoting')
  }

  if (current) {
    args.push(current)
  }

  if (args.length === 0) {
    throw new Error('Command must not be empty')
  }

  return args
}

function runCommand(cwd: string, command: string): { passed: boolean; output: string } {
  try {
    const [file, ...args] = parseCommandArgs(command)
    const output = execFileSync(file, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return { passed: true, output }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    return {
      passed: false,
      output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim(),
    }
  }
}

function buildStagePrompt(stage: LoopStageName, session: LoopSession, tasks: LoopTask[]): string {
  const stageTasks = tasks.filter(task => task.stage === stage)
  const taskText = stageTasks.map(task => {
    const criteria = task.successCriteria.map(item => `- ${item}`).join('\n')
    return `Task ${task.id}: ${task.title}\n${task.description}\nSuccess Criteria:\n${criteria}`
  }).join('\n\n')

  return `You are executing Magpie loop stage "${stage}".

Goal:
${session.goal}

PRD path:
${session.prdPath}

Current stage tasks:
${taskText || '- Complete this stage with best effort.'}

Execution requirements:
1. Make concrete progress in repository files and/or commands where needed.
2. Keep changes minimal and aligned with the goal.
3. At the end, output a concise stage report in markdown.
4. Include a section "Artifacts" with file paths touched or generated.

Return markdown only.`
}

async function evaluateStage(
  planner: AIProvider,
  stage: LoopStageName,
  stageReport: string,
  testOutput: string
): Promise<StageEvaluation> {
  const prompt = `Evaluate this stage execution quality. Return ONLY JSON.

Stage: ${stage}
Stage report:
${stageReport}

Test output:
${testOutput || '(none)'}

JSON schema:
\`\`\`json
{
  "confidence": 0.0,
  "risks": ["..."],
  "requireHumanConfirmation": false,
  "summary": "..."
}
\`\`\``

  const messages: Message[] = [{ role: 'user', content: prompt }]
  const response = await planner.chat(messages, undefined, { disableTools: true })
  const parsed = extractJsonBlock<StageEvaluation>(response)

  if (!parsed) {
    return {
      confidence: 0.5,
      risks: ['Failed to parse evaluation JSON from planner model'],
      requireHumanConfirmation: true,
      summary: 'Evaluation parsing failed; human review required.',
    }
  }

  return {
    confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    requireHumanConfirmation: parsed.requireHumanConfirmation === true,
    summary: parsed.summary || 'No summary provided.',
  }
}

function shouldGateHuman(
  runtime: LoopRuntimeConfig,
  stageSucceeded: boolean,
  evaluation: StageEvaluation
): boolean {
  if (runtime.gatePolicy === 'always') return true
  if (runtime.gatePolicy === 'manual_only') return false

  if (!stageSucceeded) return true
  if (evaluation.requireHumanConfirmation) return true
  return evaluation.confidence < runtime.confidenceThreshold
}

function buildActionUrl(filePath: string, line: number, clickTarget: 'vscode' | 'file'): string {
  const absolute = resolve(filePath)
  const encoded = encodeURI(absolute)
  if (clickTarget === 'file') {
    return `file://${encoded}`
  }
  return `vscode://file/${encoded}:${line}`
}

function resolveClickTarget(fallback: 'vscode' | 'file', notifications: unknown): 'vscode' | 'file' {
  const data = notifications as {
    providers?: Record<string, { type?: string; click_target?: 'vscode' | 'file' }>
    routes?: Record<string, string[]>
  } | undefined

  const route = data?.routes?.human_confirmation_required || []
  for (const providerId of route) {
    const provider = data?.providers?.[providerId]
    if (provider?.type === 'macos') {
      return provider.click_target || fallback
    }
  }
  return fallback
}

async function appendEvent(path: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`, 'utf-8')
}

function ensureBranch(prefix: string, cwd: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
  } catch {
    return null
  }

  const normalizedPrefix = prefix.startsWith('sch/') ? prefix : `sch/${prefix.replace(/^\/+/, '')}`
  const sanitizedPrefix = normalizedPrefix
    .replace(/[^a-zA-Z0-9/_\-.]/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^-+/, '')
    .replace(/\/-+/g, '/')
  const safePrefix = sanitizedPrefix.length > 0 ? sanitizedPrefix : 'sch'
  const finalPrefix = safePrefix.endsWith('/') ? safePrefix : `${safePrefix}/`
  const branchName = `${finalPrefix}${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)}`
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName) || branchName.length > 100) {
    return null
  }

  try {
    execFileSync('git', ['check-ref-format', '--branch', branchName], { stdio: 'pipe', cwd })
  } catch {
    return null
  }

  try {
    execFileSync('git', ['checkout', '-b', branchName], { stdio: 'pipe', cwd })
    return branchName
  } catch {
    return null
  }
}

function commitIfChanged(
  stage: LoopStageName,
  cwd: string,
  expectedBranch?: string,
): { committed: boolean; reason?: string } {
  try {
    if (expectedBranch) {
      const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf-8',
        cwd,
      }).trim()
      if (currentBranch !== expectedBranch) {
        return {
          committed: false,
          reason: `branch_mismatch:${currentBranch}`,
        }
      }
    }

    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd }).trim()
    if (!status) {
      return {
        committed: false,
        reason: 'no_changes',
      }
    }

    execFileSync('git', ['add', '-A'], { stdio: 'pipe', cwd })
    execFileSync('git', ['commit', '-m', `feat(loop): 完成${stage}`], { stdio: 'pipe', cwd })
    return {
      committed: true,
    }
  } catch (error) {
    return {
      committed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function markSessionFailed(
  session: LoopSession,
  stage: LoopStageName,
  reason: string,
  stateManager: StateManager,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
): Promise<LoopExecutionResult> {
  session.currentStageIndex = session.stages.indexOf(stage)
  if (session.currentStageIndex < 0) {
    session.currentStageIndex = 0
  }
  session.status = 'failed'
  session.updatedAt = new Date()
  await stateManager.saveLoopSession(session)
  await appendEvent(session.artifacts.eventsPath, { event: 'loop_failed', stage, reason })

  await notificationRouter.dispatch({
    type: 'loop_failed',
    sessionId: session.id,
    title: 'Magpie loop failed',
    message: `Session ${session.id} failed at stage ${stage}: ${reason}`,
    severity: 'error',
    dedupeKey: `failed:${session.id}:${stage}`,
    metadata: { reason },
  })

  return {
    status: 'failed',
    summary: `Loop failed at stage ${stage}. Session: ${session.id}. Reason: ${reason}`,
    session,
  }
}

async function waitForHumanDecision(
  filePath: string,
  itemId: string,
  pollIntervalSec: number,
  maxIterations: number
): Promise<HumanConfirmationItem | null> {
  for (let i = 0; i < maxIterations; i++) {
    const item = await findHumanConfirmationDecision(filePath, itemId)
    if (item && item.decision !== 'pending') {
      return item
    }
    await sleep(pollIntervalSec * 1000)
  }

  return null
}

async function runSingleStage(
  stage: LoopStageName,
  session: LoopSession,
  tasks: LoopTask[],
  runtime: LoopRuntimeConfig,
  planner: AIProvider,
  executor: AIProvider,
  router: ReturnType<typeof createNotificationRouter>,
  waitHuman: boolean,
  dryRun: boolean,
  notificationsConfig: unknown,
  runCwd: string,
): Promise<StageRunResult> {
  const stageArtifactPath = join(session.artifacts.sessionDir, `${stage}.md`)
  let stageReport = ''
  let stageSucceeded = true
  let testOutput = ''

  if (dryRun) {
    stageReport = `# Dry Run\n\nStage ${stage} skipped due to --dry-run.`
  } else {
    const stagePrompt = buildStagePrompt(stage, session, tasks)
    const response = await executor.chat([{ role: 'user', content: stagePrompt }])
    stageReport = response
    await mkdir(dirname(stageArtifactPath), { recursive: true })
    await writeFile(stageArtifactPath, response, 'utf-8')

    if (stage === 'unit_mock_test') {
      const unit = runCommand(runCwd, runtime.commands.unitTest)
      const mock = runCommand(runCwd, runtime.commands.mockTest)
      stageSucceeded = unit.passed && mock.passed
      testOutput = [
        `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
        `## Mock Test (${runtime.commands.mockTest})\n${mock.output}`,
      ].join('\n\n')
    }

    if (stage === 'integration_test') {
      const integration = runCommand(runCwd, runtime.commands.integrationTest)
      stageSucceeded = integration.passed
      testOutput = `## Integration Test (${runtime.commands.integrationTest})\n${integration.output}`
    }
  }

  const evaluation = await evaluateStage(planner, stage, stageReport, testOutput)
  const gateHuman = shouldGateHuman(runtime, stageSucceeded, evaluation)

  const stageResult: LoopStageResult = {
    stage,
    success: stageSucceeded,
    confidence: evaluation.confidence,
    summary: evaluation.summary,
    risks: evaluation.risks,
    retryCount: 0,
    artifacts: existsSync(stageArtifactPath) ? [stageArtifactPath] : [],
    timestamp: new Date(),
  }

  if (!gateHuman) {
    return {
      stageResult,
      paused: false,
      failed: !stageSucceeded,
    }
  }

  const confirmationItem: HumanConfirmationItem = {
    id: generateId(),
    sessionId: session.id,
    stage,
    status: 'pending',
    decision: 'pending',
    rationale: '',
    reason: evaluation.risks.join('; ') || 'Low confidence or failed stage execution',
    artifacts: stageResult.artifacts,
    nextAction: stageSucceeded ? 'Review risk and approve to continue' : 'Fix stage and approve rerun',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const clickTarget = resolveClickTarget('vscode', notificationsConfig)
  const lineNumber = await appendHumanConfirmationItem(session.artifacts.humanConfirmationPath, confirmationItem)
  const actionUrl = buildActionUrl(session.artifacts.humanConfirmationPath, lineNumber, clickTarget)

  session.humanConfirmations.push(confirmationItem)

  const event: NotificationEvent = {
    type: 'human_confirmation_required',
    sessionId: session.id,
    title: `Magpie Loop需要人工确认 (${stage})`,
    message: confirmationItem.reason,
    severity: 'warning',
    actionUrl,
    dedupeKey: `${session.id}:${confirmationItem.id}`,
    metadata: {
      stage,
      file: session.artifacts.humanConfirmationPath,
      line: lineNumber,
    },
  }

  const dispatch = await router.dispatch(event)
  await appendEvent(session.artifacts.eventsPath, {
    event: event.type,
    actionUrl,
    delivered: dispatch.delivered,
    attempted: dispatch.attempted,
  })

  if (!waitHuman) {
    return {
      stageResult,
      paused: true,
      failed: false,
    }
  }

  const decided = await waitForHumanDecision(
    session.artifacts.humanConfirmationPath,
    confirmationItem.id,
    runtime.pollIntervalSec,
    runtime.maxIterations
  )

  if (!decided) {
    return {
      stageResult,
      paused: true,
      failed: false,
    }
  }

  confirmationItem.decision = decided.decision
  confirmationItem.status = decided.decision === 'approved' ? 'approved' : decided.decision
  confirmationItem.rationale = decided.rationale
  confirmationItem.updatedAt = new Date()

  if (decided.decision === 'approved') {
    return {
      stageResult,
      paused: false,
      failed: !stageSucceeded,
    }
  }

  if (decided.decision === 'rejected' || decided.decision === 'revise') {
    if (!existsSync(stageArtifactPath)) {
      await mkdir(dirname(stageArtifactPath), { recursive: true })
      await writeFile(stageArtifactPath, stageReport || `# Stage ${stage}`, 'utf-8')
    }

    let finalEval = evaluation
    let finalSucceeded = stageSucceeded
    let finalTestOutput = testOutput
    const maxRetries = Math.max(0, runtime.retriesPerStage)

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const replanPrompt = `Human rejected stage ${stage}. Retry ${attempt}/${maxRetries}. Rerun this stage with this rationale:\n${decided.rationale || '(none provided)'}\n\nGoal: ${session.goal}`
      const replanOutput = await planner.chat([{ role: 'user', content: replanPrompt }])
      await appendFile(stageArtifactPath, `\n\n## Human Replan Guidance (Retry ${attempt})\n${replanOutput}\n`, 'utf-8')

      const retried = await executor.chat([{ role: 'user', content: `${buildStagePrompt(stage, session, tasks)}\n\nAdditional guidance:\n${replanOutput}` }])
      await appendFile(stageArtifactPath, `\n\n## Retry Execution (${attempt})\n${retried}\n`, 'utf-8')

      if (stage === 'unit_mock_test') {
        const unit = runCommand(runCwd, runtime.commands.unitTest)
        const mock = runCommand(runCwd, runtime.commands.mockTest)
        finalSucceeded = unit.passed && mock.passed
        finalTestOutput = [
          `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
          `## Mock Test (${runtime.commands.mockTest})\n${mock.output}`,
        ].join('\n\n')
      } else if (stage === 'integration_test') {
        const integration = runCommand(runCwd, runtime.commands.integrationTest)
        finalSucceeded = integration.passed
        finalTestOutput = `## Integration Test (${runtime.commands.integrationTest})\n${integration.output}`
      } else {
        finalSucceeded = true
      }

      finalEval = await evaluateStage(planner, stage, retried, finalTestOutput)
      stageResult.retryCount = attempt
      stageResult.confidence = finalEval.confidence
      stageResult.summary = finalEval.summary
      stageResult.risks = finalEval.risks
      stageResult.success = finalSucceeded

      const passed = finalSucceeded
        && finalEval.confidence >= runtime.confidenceThreshold
        && !finalEval.requireHumanConfirmation
      if (passed) {
        return {
          stageResult,
          paused: false,
          failed: false,
        }
      }
    }

    stageResult.confidence = finalEval.confidence
    stageResult.summary = finalEval.summary
    stageResult.risks = finalEval.risks
    stageResult.success = false

    return {
      stageResult,
      paused: false,
      failed: true,
    }
  }

  return {
    stageResult,
    paused: true,
    failed: false,
  }
}

async function continueSession(
  session: LoopSession,
  prepared: LoopPreparedInput,
  runCwd: string,
  runtime: LoopRuntimeConfig,
  planner: AIProvider,
  executor: AIProvider,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  notificationsConfig: unknown,
  stateManager: StateManager
): Promise<LoopExecutionResult> {
  for (let i = session.currentStageIndex; i < session.stages.length; i++) {
    const stage = session.stages[i]
    let stageRun: StageRunResult
    try {
      stageRun = await runSingleStage(
        stage,
        session,
        session.plan,
        runtime,
        planner,
        executor,
        notificationRouter,
        prepared.waitHuman !== false,
        prepared.dryRun === true,
        notificationsConfig,
        runCwd,
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return markSessionFailed(session, stage, reason, stateManager, notificationRouter)
    }

    session.stageResults.push(stageRun.stageResult)
    session.updatedAt = new Date()

    if (stageRun.paused) {
      session.currentStageIndex = i
      session.status = 'paused_for_human'
      await stateManager.saveLoopSession(session)
      await appendEvent(session.artifacts.eventsPath, { event: 'loop_paused', stage })

      await notificationRouter.dispatch({
        type: 'loop_paused',
        sessionId: session.id,
        title: 'Magpie loop paused',
        message: `Session ${session.id} paused at stage ${stage}`,
        severity: 'warning',
        dedupeKey: `paused:${session.id}:${stage}`,
      })

      return {
        status: 'paused',
        summary: `Loop paused for human confirmation at stage ${stage}. Session: ${session.id}`,
        session,
      }
    }

    if (stageRun.failed) {
      return markSessionFailed(session, stage, 'Stage execution reported failure', stateManager, notificationRouter)
    }

    session.currentStageIndex = i + 1
    if (runtime.autoCommit && session.branchName && stageRun.stageResult.success && prepared.dryRun !== true) {
      const commitResult = commitIfChanged(stage, runCwd, session.branchName)
      await appendEvent(session.artifacts.eventsPath, {
        event: 'auto_commit',
        stage,
        committed: commitResult.committed,
        ...(commitResult.reason ? { reason: commitResult.reason } : {}),
      })
    }

    await stateManager.saveLoopSession(session)
  }

  session.status = 'completed'
  session.updatedAt = new Date()
  await stateManager.saveLoopSession(session)
  await appendEvent(session.artifacts.eventsPath, { event: 'loop_completed' })

  await notificationRouter.dispatch({
    type: 'loop_completed',
    sessionId: session.id,
    title: 'Magpie loop completed',
    message: `Session ${session.id} completed all stages.`,
    severity: 'info',
    dedupeKey: `completed:${session.id}`,
  })

  return {
    status: 'completed',
    summary: `Loop completed successfully. Session: ${session.id}`,
    session,
  }
}

async function executeRun(prepared: LoopPreparedInput, ctx: CapabilityContext): Promise<LoopExecutionResult> {
  if (!prepared.goal) {
    throw new Error('loop run requires a goal')
  }
  if (!prepared.prdPath) {
    throw new Error('loop run requires --prd path')
  }

  const config = loadConfig(ctx.configPath)
  const loopRuntime = resolveLoopConfig(config.capabilities.loop)
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)

  const planner = createProvider(loopRuntime.plannerModel, config)
  const executor = createProvider(loopRuntime.executorModel, config)

  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()

  const sessionId = generateId()
  const sessionDir = join(homedir(), '.magpie', 'loop-sessions', sessionId)
  const eventsPath = join(sessionDir, 'events.jsonl')
  const planPath = join(sessionDir, 'plan.json')
  const humanConfirmationPath = resolve(ctx.cwd, loopRuntime.humanConfirmationFile)

  await mkdir(sessionDir, { recursive: true })

  const tasks = await generateLoopPlan(planner, prepared.goal, prepared.prdPath, loopRuntime.stages)
  await writeFile(planPath, JSON.stringify(tasks, null, 2), 'utf-8')

  const branchName = (loopRuntime.autoCommit && prepared.dryRun !== true)
    ? ensureBranch(loopRuntime.autoBranchPrefix, ctx.cwd) || undefined
    : undefined

  const session: LoopSession = {
    id: sessionId,
    title: prepared.goal.slice(0, 60),
    goal: prepared.goal,
    prdPath: resolve(prepared.prdPath),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'running',
    currentStageIndex: 0,
    stages: loopRuntime.stages,
    plan: tasks,
    stageResults: [],
    humanConfirmations: [],
    branchName,
    artifacts: {
      sessionDir,
      eventsPath,
      planPath,
      humanConfirmationPath,
    },
  }

  await stateManager.saveLoopSession(session)
  await appendEvent(eventsPath, { event: 'loop_started', goal: prepared.goal })
  if (loopRuntime.autoCommit && prepared.dryRun !== true && !branchName) {
    ctx.logger.warn('[loop] Auto-commit disabled because branch creation failed; changes will remain on the current branch.')
    await appendEvent(eventsPath, {
      event: 'auto_commit_disabled',
      reason: 'branch_creation_failed',
    })
  }

  return continueSession(
    session,
    prepared,
    ctx.cwd,
    loopRuntime,
    planner,
    executor,
    notificationRouter,
    config.integrations.notifications,
    stateManager
  )
}

async function executeResume(prepared: LoopPreparedInput, ctx: CapabilityContext): Promise<LoopExecutionResult> {
  if (!prepared.sessionId) {
    throw new Error('loop resume requires a session id')
  }

  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()

  const all = await stateManager.listLoopSessions()
  const matches = all.filter((item) => item.id === prepared.sessionId || item.id.startsWith(prepared.sessionId || ''))

  if (matches.length === 0) {
    throw new Error(`No loop session found matching "${prepared.sessionId}"`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple loop sessions match "${prepared.sessionId}", use full id`)
  }

  const session = matches[0]

  if (session.status === 'completed') {
    return {
      status: 'completed',
      summary: `Session ${session.id} already completed.`,
      session,
    }
  }

  if (session.status === 'failed') {
    return {
      status: 'failed',
      summary: `Session ${session.id} is failed. Start a new run or manually fix and resume from artifacts.`,
      session,
    }
  }

  const config = loadConfig(ctx.configPath)
  const loopRuntime = resolveLoopConfig(config.capabilities.loop)
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)

  const planner = createProvider(loopRuntime.plannerModel, config)
  const executor = createProvider(loopRuntime.executorModel, config)

  if (!session.plan || session.plan.length === 0) {
    session.plan = await generateLoopPlan(planner, session.goal, session.prdPath, session.stages)
    await writeFile(session.artifacts.planPath, JSON.stringify(session.plan, null, 2), 'utf-8')
  }

  if (session.status === 'paused_for_human') {
    await notificationRouter.dispatch({
      type: 'loop_resumed',
      sessionId: session.id,
      title: 'Magpie loop resumed',
      message: `Session ${session.id} resumed from stage index ${session.currentStageIndex}.`,
      severity: 'info',
      dedupeKey: `resumed:${session.id}:${session.currentStageIndex}`,
    })
  }

  session.status = 'running'
  session.updatedAt = new Date()
  await stateManager.saveLoopSession(session)

  return continueSession(
    session,
    prepared,
    ctx.cwd,
    loopRuntime,
    planner,
    executor,
    notificationRouter,
    config.integrations.notifications,
    stateManager
  )
}

async function executeList(ctx: CapabilityContext): Promise<LoopExecutionResult> {
  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()
  const sessions = await stateManager.listLoopSessions()

  return {
    status: 'listed',
    summary: `Found ${sessions.length} loop session(s).`,
    sessions,
  }
}

export async function executeLoop(
  prepared: LoopPreparedInput,
  ctx: CapabilityContext
): Promise<LoopExecutionResult> {
  if (prepared.mode === 'list') {
    return executeList(ctx)
  }

  if (prepared.mode === 'resume') {
    return executeResume(prepared, ctx)
  }

  return executeRun(prepared, ctx)
}

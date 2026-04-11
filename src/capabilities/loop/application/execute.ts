import { randomBytes } from 'crypto'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import type { CapabilityContext } from '../../../core/capability/context.js'
import { createRoutingDecision, isRoutingEnabled } from '../../routing/index.js'
import type {
  HumanConfirmationItem,
  LoopSession,
  LoopStageResult,
  LoopTask,
} from '../../../core/state/index.js'
import { StateManager } from '../../../core/state/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { getMagpieHomeDir } from '../../../platform/paths.js'
import { createConfiguredProvider } from '../../../platform/providers/index.js'
import type { AIProvider, Message } from '../../../platform/providers/index.js'
import type { LoopConfig, LoopStageName } from '../../../config/types.js'
import type { NotificationEvent } from '../../../platform/integrations/notifications/types.js'
import { createNotificationRouter } from '../../../platform/integrations/notifications/factory.js'
import { createPlanningRouter } from '../../../platform/integrations/planning/factory.js'
import {
  buildPlanningContextBlock,
  extractPlanningItemKey,
} from '../../../platform/integrations/planning/index.js'
import {
  buildCommandSafetyConfig,
  runSafeCommand,
} from '../../workflows/shared/runtime.js'
import { extractJsonBlock } from '../../../trd/renderer.js'
import {
  appendHumanConfirmationItem,
  findHumanConfirmationDecision,
} from '../domain/human-confirmation.js'
import { generateAutoCommitMessage } from '../domain/auto-commit-message.js'
import { resolveAutoCommitProviderBinding } from '../domain/auto-commit-provider-binding.js'
import { generateLoopPlan } from '../domain/planner.js'
import type { LoopExecutionResult, LoopPreparedInput } from '../types.js'
import {
  createTaskKnowledge,
  promoteKnowledgeCandidates,
  renderKnowledgeContext,
  updateTaskKnowledgeState,
  updateTaskKnowledgeSummary,
  writeTaskKnowledgeFinal,
  type KnowledgeArtifacts,
  type KnowledgeCandidate,
} from '../../../knowledge/runtime.js'

const DEFAULT_STAGES: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'code_development',
  'unit_mock_test',
  'integration_test',
]

interface LoopRuntimeConfig {
  plannerTool?: string
  plannerModel: string
  plannerAgent?: string
  executorTool?: string
  executorModel: string
  executorAgent?: string
  autoCommitModel?: string
  stages: LoopStageName[]
  confidenceThreshold: number
  retriesPerStage: number
  maxIterations: number
  autoCommit: boolean
  reuseCurrentBranch: boolean
  autoBranchPrefix: string
  humanConfirmationFile: string
  pollIntervalSec: number
  gatePolicy: 'exception_or_low_confidence' | 'always' | 'manual_only'
  commands: {
    unitTest: string
    mockTest?: string
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
  stageReport: string
  testOutput: string
}

interface WorktreeResolution {
  workspaceMode: 'current' | 'worktree'
  workspacePath: string
  worktreeBranch?: string
  failureReason?: string
}

function generateId(): string {
  return randomBytes(6).toString('hex')
}

function resolveLoopConfig(config: LoopConfig | undefined): LoopRuntimeConfig {
  return {
    plannerTool: config?.planner_tool,
    plannerModel: config?.planner_model || 'claude-code',
    plannerAgent: config?.planner_agent,
    executorTool: config?.executor_tool,
    executorModel: config?.executor_model || 'codex',
    executorAgent: config?.executor_agent,
    autoCommitModel: config?.auto_commit_model?.trim() || undefined,
    stages: config?.stages && config.stages.length > 0 ? config.stages : DEFAULT_STAGES,
    confidenceThreshold: config?.confidence_threshold ?? 0.78,
    retriesPerStage: config?.retries_per_stage ?? 2,
    maxIterations: config?.max_iterations ?? 30,
    autoCommit: config?.auto_commit !== false,
    reuseCurrentBranch: config?.reuse_current_branch === true,
    autoBranchPrefix: config?.auto_branch_prefix || 'sch/',
    humanConfirmationFile: config?.human_confirmation?.file || 'human_confirmation.md',
    pollIntervalSec: config?.human_confirmation?.poll_interval_sec || 8,
    gatePolicy: config?.human_confirmation?.gate_policy || 'exception_or_low_confidence',
    commands: {
      unitTest: config?.commands?.unit_test || 'npm run test:run',
      mockTest: config?.commands?.mock_test?.trim() || undefined,
      integrationTest: config?.commands?.integration_test || 'npm run test:run -- tests/integration',
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveFn => setTimeout(resolveFn, ms))
}

function runOptionalCommand(
  cwd: string,
  command: string | undefined,
  skippedMessage: string,
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>
): { passed: boolean; output: string; commandLabel: string } {
  if (!command) {
    return {
      passed: true,
      output: skippedMessage,
      commandLabel: '(skipped)',
    }
  }

  const result = runSafeCommand(cwd, command, {
    safety: commandSafety,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  })
  return {
    ...result,
    commandLabel: command,
  }
}

function renderPlanSummary(tasks: LoopTask[]): string {
  return [
    '# Plan',
    '',
    ...tasks.map((task) => `- [${task.stage}] ${task.title}: ${task.description}`),
  ].join('\n')
}

function renderStageKnowledge(stageRun: StageRunResult): string {
  return [
    `# Stage ${stageRun.stageResult.stage}`,
    '',
    `Success: ${stageRun.stageResult.success ? 'yes' : 'no'}`,
    `Confidence: ${stageRun.stageResult.confidence}`,
    '',
    stageRun.stageResult.summary,
    '',
    stageRun.stageResult.risks.length > 0 ? 'Risks:' : 'Risks: none',
    ...stageRun.stageResult.risks.map((risk) => `- ${risk}`),
    '',
    'Artifacts:',
    ...(stageRun.stageResult.artifacts.length > 0
      ? stageRun.stageResult.artifacts.map((artifact) => `- ${artifact}`)
      : ['- None']),
  ].join('\n')
}

function renderOpenIssues(stageRun: StageRunResult): string {
  if (stageRun.stageResult.success && stageRun.stageResult.risks.length === 0) {
    return '# Open Issues\n\n- None.\n'
  }

  return [
    '# Open Issues',
    '',
    ...(
      stageRun.stageResult.risks.length > 0
        ? stageRun.stageResult.risks.map((risk) => `- ${risk}`)
        : ['- Stage did not complete successfully.']
    ),
  ].join('\n')
}

function renderEvidence(stageRun: StageRunResult): string {
  const excerpt = stageRun.testOutput
    ? stageRun.testOutput.slice(0, 400)
    : stageRun.stageReport.slice(0, 400)

  return [
    '# Evidence',
    '',
    ...stageRun.stageResult.artifacts.map((artifact) => `- ${artifact}`),
    excerpt ? '' : undefined,
    excerpt ? 'Excerpt:' : undefined,
    excerpt ? excerpt : undefined,
  ].filter(Boolean).join('\n')
}

function buildLoopCandidates(session: LoopSession, approved: boolean, summary: string, evidencePath?: string): KnowledgeCandidate[] {
  if (approved) {
    return [{
      type: 'decision',
      title: session.goal,
      summary,
      sourceSessionId: session.id,
      evidencePath,
      status: 'candidate',
    }]
  }

  return [{
    type: 'failure-pattern',
    title: summary,
    summary,
    sourceSessionId: session.id,
    evidencePath,
    status: 'candidate',
  }]
}

function buildStagePrompt(stage: LoopStageName, session: LoopSession, tasks: LoopTask[], knowledgeContext: string): string {
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

${knowledgeContext}

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

function buildBranchName(prefix: string, cwd: string): string | null {
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

  return branchName
}

function ensureBranch(prefix: string, cwd: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
  } catch {
    return null
  }

  const branchName = buildBranchName(prefix, cwd)
  if (!branchName) {
    return null
  }

  try {
    execFileSync('git', ['checkout', '-b', branchName], { stdio: 'pipe', cwd })
    return branchName
  } catch {
    return null
  }
}

function getCurrentBranch(cwd: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
    const branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      cwd,
    }).trim()
    if (!branchName || branchName === 'HEAD') {
      return null
    }
    return branchName
  } catch {
    return null
  }
}

function shouldReuseCurrentBranch(branchName: string | null): branchName is string {
  if (!branchName) return false
  return branchName !== 'main' && branchName !== 'master'
}

function resolveExecutionHost(prepared: LoopPreparedInput): 'foreground' | 'tmux' {
  if (prepared.host === 'tmux' || process.env.MAGPIE_EXECUTION_HOST === 'tmux') {
    return 'tmux'
  }
  return 'foreground'
}

function resolveTmuxArtifacts(): Pick<LoopSession['artifacts'], 'tmuxSession' | 'tmuxWindow' | 'tmuxPane'> {
  return {
    tmuxSession: process.env.MAGPIE_TMUX_SESSION || undefined,
    tmuxWindow: process.env.MAGPIE_TMUX_WINDOW || undefined,
    tmuxPane: process.env.MAGPIE_TMUX_PANE || undefined,
  }
}

function resolveWorktreeDirectory(cwd: string): string | null {
  if (existsSync(join(cwd, '.worktrees'))) return '.worktrees'
  if (existsSync(join(cwd, 'worktrees'))) return 'worktrees'
  return null
}

function isIgnoredPath(cwd: string, relativePath: string): boolean {
  for (const candidate of [relativePath, join(relativePath, '.magpie-ignore-probe')]) {
    try {
      execFileSync('git', ['check-ignore', candidate], { cwd, stdio: 'pipe' })
      return true
    } catch {
      continue
    }
  }

  return false
}

function ensureWorktree(prefix: string, cwd: string): WorktreeResolution {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd })
  } catch {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'worktree requires a git repository',
    }
  }

  const directory = resolveWorktreeDirectory(cwd)
  if (!directory) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'No worktree directory found. Create .worktrees/ or worktrees/ first.',
    }
  }

  if (!isIgnoredPath(cwd, directory)) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: `Worktree directory ${directory} is not ignored by git.`,
    }
  }

  const branchName = buildBranchName(prefix, cwd)
  if (!branchName) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: 'Failed to generate a valid worktree branch name.',
    }
  }

  const workspacePath = join(cwd, directory, branchName)
  try {
    execFileSync('git', ['worktree', 'add', workspacePath, '-b', branchName], { cwd, stdio: 'pipe' })
    return {
      workspaceMode: 'worktree',
      workspacePath,
      worktreeBranch: branchName,
    }
  } catch (error) {
    return {
      workspaceMode: 'current',
      workspacePath: cwd,
      failureReason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function commitIfChanged(
  stage: LoopStageName,
  cwd: string,
  provider: AIProvider,
  expectedBranch?: string,
): Promise<{ committed: boolean; reason?: string; message?: string; source?: 'ai' | 'fallback' }> {
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
    const commitMessage = await generateAutoCommitMessage({
      cwd,
      stage,
      provider,
    })
    execFileSync('git', ['commit', '-m', commitMessage.message], { stdio: 'pipe', cwd })
    return {
      committed: true,
      message: commitMessage.message,
      source: commitMessage.source,
      ...(commitMessage.reason ? { reason: commitMessage.reason } : {}),
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
  await updateLoopState(session, {
    currentStage: stage,
    lastReliableResult: `Stage ${stage} failed.`,
    nextAction: 'Inspect failure details and replan.',
    currentBlocker: reason,
  }, `Loop failed at stage ${stage}.`)
  await stateManager.saveLoopSession(session)
  await appendEvent(session.artifacts.eventsPath, { event: 'loop_failed', stage, reason })
  await finalizeLoopKnowledge(session, false, [
    '# Final Summary',
    '',
    `Loop failed at stage ${stage}.`,
    '',
    reason,
  ].join('\n'), reason, session.artifacts.eventsPath, 'Loop failed.')

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

async function finalizeLoopKnowledge(
  session: LoopSession,
  approved: boolean,
  content: string,
  summary: string,
  evidencePath: string | undefined,
  logMessage: string
): Promise<void> {
  const artifacts = resolveLoopKnowledgeArtifacts(session)
  if (!artifacts) {
    return
  }

  const candidates = buildLoopCandidates(session, approved, summary, evidencePath)
  try {
    await updateTaskKnowledgeState(artifacts, {
      currentStage: approved ? 'completed' : 'failed',
      lastReliableResult: summary,
      nextAction: approved ? 'No further action.' : 'Inspect failure details and replan.',
      currentBlocker: approved ? 'None.' : summary,
    }, `Loop state updated for ${approved ? 'completion' : 'failure'}.`)
    await writeTaskKnowledgeFinal(artifacts, content, candidates, logMessage)
    await promoteKnowledgeCandidates(session.artifacts.repoRootPath || session.artifacts.sessionDir, candidates)
  } catch {
    return
  }
}

function resolveLoopKnowledgeArtifacts(session: LoopSession): KnowledgeArtifacts | null {
  if (!session.artifacts.knowledgeSummaryDir) {
    return null
  }

  return {
    knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
    knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
    knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
    knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
    knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
  }
}

async function updateLoopState(
  session: LoopSession,
  state: Parameters<typeof updateTaskKnowledgeState>[1],
  logMessage: string
): Promise<void> {
  const artifacts = resolveLoopKnowledgeArtifacts(session)
  if (!artifacts) {
    return
  }

  await updateTaskKnowledgeState(artifacts, state, logMessage)
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
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>,
): Promise<StageRunResult> {
  const stageArtifactPath = join(session.artifacts.sessionDir, `${stage}.md`)
  let stageReport = ''
  let stageSucceeded = true
  let testOutput = ''
  const knowledgeContext = session.artifacts.knowledgeSummaryDir && session.artifacts.knowledgeSchemaPath
    ? await renderKnowledgeContext({
      knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath,
      knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'index.md'),
      knowledgeLogPath: session.artifacts.knowledgeLogPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'log.md'),
      knowledgeStatePath: session.artifacts.knowledgeStatePath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'state.json'),
      knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
      knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(resolve(session.artifacts.knowledgeSummaryDir, '..'), 'candidates.json'),
    }, runCwd)
    : ''

  if (dryRun) {
    stageReport = `# Dry Run\n\nStage ${stage} skipped due to --dry-run.`
  } else {
    const stagePrompt = buildStagePrompt(stage, session, tasks, knowledgeContext)
    const response = await executor.chat([{ role: 'user', content: stagePrompt }])
    stageReport = response
    await mkdir(dirname(stageArtifactPath), { recursive: true })
    await writeFile(stageArtifactPath, response, 'utf-8')

    if (stage === 'unit_mock_test') {
      const unit = runSafeCommand(runCwd, runtime.commands.unitTest, {
        safety: commandSafety,
        interactive: process.stdin.isTTY && process.stdout.isTTY,
      })
      const mock = runOptionalCommand(
        runCwd,
        runtime.commands.mockTest,
        'Skipped: no mock test command configured.',
        commandSafety
      )
      stageSucceeded = unit.passed && mock.passed
      testOutput = [
        `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
        `## Mock Test (${mock.commandLabel})\n${mock.output}`,
      ].join('\n\n')
    }

    if (stage === 'integration_test') {
      const integration = runSafeCommand(runCwd, runtime.commands.integrationTest, {
        safety: commandSafety,
        interactive: process.stdin.isTTY && process.stdout.isTTY,
      })
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
      stageReport,
      testOutput,
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
      stageReport,
      testOutput,
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
      stageReport,
      testOutput,
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
      stageReport,
      testOutput,
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

      const retried = await executor.chat([{ role: 'user', content: `${buildStagePrompt(stage, session, tasks, knowledgeContext)}\n\nAdditional guidance:\n${replanOutput}` }])
      await appendFile(stageArtifactPath, `\n\n## Retry Execution (${attempt})\n${retried}\n`, 'utf-8')

      if (stage === 'unit_mock_test') {
        const unit = runSafeCommand(runCwd, runtime.commands.unitTest, {
          safety: commandSafety,
          interactive: process.stdin.isTTY && process.stdout.isTTY,
        })
        const mock = runOptionalCommand(
          runCwd,
          runtime.commands.mockTest,
          'Skipped: no mock test command configured.',
          commandSafety
        )
        finalSucceeded = unit.passed && mock.passed
        finalTestOutput = [
          `## Unit Test (${runtime.commands.unitTest})\n${unit.output}`,
          `## Mock Test (${mock.commandLabel})\n${mock.output}`,
        ].join('\n\n')
      } else if (stage === 'integration_test') {
        const integration = runSafeCommand(runCwd, runtime.commands.integrationTest, {
          safety: commandSafety,
          interactive: process.stdin.isTTY && process.stdout.isTTY,
        })
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
          stageReport,
          testOutput: finalTestOutput,
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
      stageReport,
      testOutput: finalTestOutput,
    }
  }

  return {
    stageResult,
    paused: true,
    failed: false,
    stageReport,
    testOutput,
  }
}

async function continueSession(
  session: LoopSession,
  prepared: LoopPreparedInput,
  runCwd: string,
  runtime: LoopRuntimeConfig,
  planner: AIProvider,
  executor: AIProvider,
  autoCommitProvider: AIProvider,
  notificationRouter: ReturnType<typeof createNotificationRouter>,
  notificationsConfig: unknown,
  stateManager: StateManager,
  commandSafety: ReturnType<typeof buildCommandSafetyConfig>
): Promise<LoopExecutionResult> {
  for (let i = session.currentStageIndex; i < session.stages.length; i++) {
    const stage = session.stages[i]
    await updateLoopState(session, {
      currentStage: stage,
      lastReliableResult: `Preparing stage ${stage}.`,
      nextAction: `Execute ${stage}.`,
      currentBlocker: 'Stage in progress.',
    }, `Loop state moved to ${stage}.`)
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
        commandSafety,
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return markSessionFailed(session, stage, reason, stateManager, notificationRouter)
    }

    session.stageResults.push(stageRun.stageResult)
    session.updatedAt = new Date()
    if (session.artifacts.knowledgeSummaryDir) {
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, `stage-${stage}`, renderStageKnowledge(stageRun), `Stage ${stage} summary updated.`)
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, 'open-issues', renderOpenIssues(stageRun), `Stage ${stage} open issues updated.`)
      await updateTaskKnowledgeSummary({
        knowledgeSchemaPath: session.artifacts.knowledgeSchemaPath || join(session.artifacts.sessionDir, 'knowledge', 'SCHEMA.md'),
        knowledgeIndexPath: session.artifacts.knowledgeIndexPath || join(session.artifacts.sessionDir, 'knowledge', 'index.md'),
        knowledgeLogPath: session.artifacts.knowledgeLogPath || join(session.artifacts.sessionDir, 'knowledge', 'log.md'),
        knowledgeStatePath: session.artifacts.knowledgeStatePath || join(session.artifacts.sessionDir, 'knowledge', 'state.json'),
        knowledgeSummaryDir: session.artifacts.knowledgeSummaryDir,
        knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath || join(session.artifacts.sessionDir, 'knowledge', 'candidates.json'),
      }, 'evidence', renderEvidence(stageRun), `Stage ${stage} evidence updated.`)
    }
    await updateLoopState(session, {
      currentStage: stage,
      lastReliableResult: stageRun.stageResult.summary,
      nextAction: stageRun.paused
        ? 'Wait for human confirmation.'
        : session.stages[i + 1]
          ? `Start ${session.stages[i + 1]}.`
          : 'Finalize loop output.',
      currentBlocker: stageRun.paused
        ? 'Waiting for human confirmation.'
        : stageRun.stageResult.success
          ? 'None.'
          : 'Stage did not complete successfully.',
    }, `Loop state refreshed after ${stage}.`)

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
      const commitResult = await commitIfChanged(stage, runCwd, autoCommitProvider, session.branchName)
      await appendEvent(session.artifacts.eventsPath, {
        event: 'auto_commit',
        stage,
        committed: commitResult.committed,
        ...(commitResult.message ? { message: commitResult.message } : {}),
        ...(commitResult.source ? { source: commitResult.source } : {}),
        ...(commitResult.reason ? { reason: commitResult.reason } : {}),
      })
    }

    await stateManager.saveLoopSession(session)
  }

  session.status = 'completed'
  session.updatedAt = new Date()
  await stateManager.saveLoopSession(session)
  await appendEvent(session.artifacts.eventsPath, { event: 'loop_completed' })
  await finalizeLoopKnowledge(
    session,
    true,
    [
      '# Final Summary',
      '',
      `Loop completed successfully for ${session.goal}.`,
      '',
      `Stages completed: ${session.stages.join(', ')}`,
    ].join('\n'),
    `Loop completed successfully for ${session.goal}.`,
    session.artifacts.planPath,
    'Loop completed successfully.'
  )

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
  const executionHost = resolveExecutionHost(prepared)
  const commandSafety = buildCommandSafetyConfig(config.capabilities.safety)
  const routingDecision = isRoutingEnabled(config) && prepared.goal && prepared.prdPath
    ? createRoutingDecision({
      goal: prepared.goal,
      prdContent: await readFile(prepared.prdPath, 'utf-8').catch(() => ''),
      overrideTier: prepared.complexity,
      config,
    })
    : undefined
  if (routingDecision) {
    loopRuntime.plannerTool = routingDecision.planning.tool
    loopRuntime.plannerModel = routingDecision.planning.model || routingDecision.planning.tool || loopRuntime.plannerModel
    loopRuntime.plannerAgent = routingDecision.planning.agent
    loopRuntime.executorTool = routingDecision.execution.tool
    loopRuntime.executorModel = routingDecision.execution.model || routingDecision.execution.tool || loopRuntime.executorModel
    loopRuntime.executorAgent = routingDecision.execution.agent
  }
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)
  const planningRouter = createPlanningRouter(config.integrations.planning)
  const planningItemKey = prepared.planningItemKey
    || extractPlanningItemKey(`${prepared.goal}\n${prepared.prdPath}`)

  const planner = createConfiguredProvider({
    logicalName: 'capabilities.loop.planner',
    tool: loopRuntime.plannerTool,
    model: loopRuntime.plannerModel,
    agent: loopRuntime.plannerAgent,
  }, config)
  const executor = createConfiguredProvider({
    logicalName: 'capabilities.loop.executor',
    tool: loopRuntime.executorTool,
    model: loopRuntime.executorModel,
    agent: loopRuntime.executorAgent,
  }, config)
  const autoCommitProvider = createConfiguredProvider(resolveAutoCommitProviderBinding({
    autoCommitModel: loopRuntime.autoCommitModel,
    executorTool: loopRuntime.executorTool,
    executorModel: loopRuntime.executorModel,
    executorAgent: loopRuntime.executorAgent,
  }), config)

  const stateManager = new StateManager(ctx.cwd)
  await stateManager.initLoopSessions()

  const sessionId = process.env.MAGPIE_SESSION_ID?.trim() || generateId()
  const sessionDir = join(getMagpieHomeDir(), 'loop-sessions', sessionId)
  const eventsPath = join(sessionDir, 'events.jsonl')
  const planPath = join(sessionDir, 'plan.json')
  const routingDecisionPath = join(sessionDir, 'routing-decision.json')

  await mkdir(sessionDir, { recursive: true })
  const knowledgeArtifacts = await createTaskKnowledge({
    sessionDir,
    capability: 'loop',
    sessionId,
    title: prepared.goal.slice(0, 60),
    goal: prepared.goal,
  })
  if (routingDecision) {
    await writeFile(routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
  }

  const planningContext = await planningRouter.createPlanContext({
    itemKey: planningItemKey,
    title: prepared.goal,
  })
  const planningContextBlock = buildPlanningContextBlock(planningContext)
  const tasks = await generateLoopPlan(
    planner,
    prepared.goal,
    prepared.prdPath,
    loopRuntime.stages,
    planningContextBlock
  )
  await writeFile(planPath, JSON.stringify(tasks, null, 2), 'utf-8')
  await updateTaskKnowledgeSummary(
    knowledgeArtifacts,
    'plan',
    renderPlanSummary(tasks),
    'Loop plan summary generated.'
  )
  await updateTaskKnowledgeState(knowledgeArtifacts, {
    currentStage: 'planning',
    lastReliableResult: 'Loop plan summary generated.',
    nextAction: tasks[0] ? `Start ${tasks[0].stage}.` : 'Finalize loop output.',
    currentBlocker: tasks.length > 0 ? 'Waiting for stage execution.' : 'No planned stages available.',
  }, 'Loop planning state initialized.')
  await planningRouter.syncPlanArtifact({
    projectKey: planningContext?.projectKey,
    itemKey: planningContext?.itemKey || planningItemKey,
    title: prepared.goal,
    body: [
      `Goal: ${prepared.goal}`,
      `PRD: ${resolve(prepared.prdPath)}`,
      '',
      'Plan:',
      JSON.stringify(tasks, null, 2),
    ].join('\n'),
  })

  let branchName: string | undefined
  let workspaceMode: 'current' | 'worktree' = 'current'
  let workspacePath = ctx.cwd
  let worktreeFailureReason: string | undefined
  const shouldUseWorktree = prepared.dryRun !== true && (routingDecision?.tier || prepared.complexity) === 'complex'
  if (shouldUseWorktree) {
    const worktree = ensureWorktree(loopRuntime.autoBranchPrefix, ctx.cwd)
    workspaceMode = worktree.workspaceMode
    workspacePath = worktree.workspacePath
    branchName = worktree.worktreeBranch
    worktreeFailureReason = worktree.failureReason
  }
  let reusedCurrentBranch = false
  if (loopRuntime.autoCommit && prepared.dryRun !== true && workspaceMode !== 'worktree' && !worktreeFailureReason) {
    const currentBranch = loopRuntime.reuseCurrentBranch
      ? getCurrentBranch(ctx.cwd)
      : null
    if (shouldReuseCurrentBranch(currentBranch)) {
      branchName = currentBranch
      reusedCurrentBranch = true
    } else {
      branchName = ensureBranch(loopRuntime.autoBranchPrefix, ctx.cwd) || undefined
    }
  }
  const humanConfirmationPath = resolve(workspacePath, loopRuntime.humanConfirmationFile)

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
    routingTier: routingDecision?.tier,
    artifacts: {
      sessionDir,
      repoRootPath: ctx.cwd,
      workspaceMode,
      workspacePath,
      ...(branchName ? { worktreeBranch: branchName } : {}),
      executionHost,
      ...resolveTmuxArtifacts(),
      eventsPath,
      planPath,
      humanConfirmationPath,
      ...knowledgeArtifacts,
      ...(routingDecision ? { routingDecisionPath } : {}),
    },
  }

  await stateManager.saveLoopSession(session)
  await appendEvent(eventsPath, { event: 'loop_started', goal: prepared.goal })
  if (workspaceMode === 'worktree') {
    await appendEvent(eventsPath, {
      event: 'worktree_created',
      workspacePath,
      branch: branchName,
    })
  }
  if (worktreeFailureReason) {
    await appendEvent(eventsPath, {
      event: 'worktree_failed',
      reason: worktreeFailureReason,
    })
    return markSessionFailed(
      session,
      session.stages[0] || 'prd_review',
      worktreeFailureReason,
      stateManager,
      notificationRouter
    )
  }
  if (reusedCurrentBranch && branchName) {
    await appendEvent(eventsPath, {
      event: 'auto_commit_branch_reused',
      branch: branchName,
    })
  }
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
    workspacePath,
    loopRuntime,
    planner,
    executor,
    autoCommitProvider,
    notificationRouter,
    config.integrations.notifications,
    stateManager,
    commandSafety
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
  const commandSafety = buildCommandSafetyConfig(config.capabilities.safety)
  const routingDecision = isRoutingEnabled(config)
    ? createRoutingDecision({
      goal: session.goal,
      prdContent: await readFile(session.prdPath, 'utf-8').catch(() => ''),
      overrideTier: prepared.complexity || session.routingTier,
      config,
    })
    : undefined
  if (routingDecision) {
    loopRuntime.plannerTool = routingDecision.planning.tool
    loopRuntime.plannerModel = routingDecision.planning.model || routingDecision.planning.tool || loopRuntime.plannerModel
    loopRuntime.plannerAgent = routingDecision.planning.agent
    loopRuntime.executorTool = routingDecision.execution.tool
    loopRuntime.executorModel = routingDecision.execution.model || routingDecision.execution.tool || loopRuntime.executorModel
    loopRuntime.executorAgent = routingDecision.execution.agent
    session.routingTier = routingDecision.tier
    if (session.artifacts.routingDecisionPath) {
      await writeFile(session.artifacts.routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
    }
  }
  if (Number.isFinite(prepared.maxIterations)) {
    loopRuntime.maxIterations = prepared.maxIterations as number
  }
  const notificationRouter = createNotificationRouter(config.integrations.notifications)
  const planningRouter = createPlanningRouter(config.integrations.planning)
  const planningItemKey = prepared.planningItemKey
    || extractPlanningItemKey(`${session.goal}\n${session.prdPath}`)

  const planner = createConfiguredProvider({
    logicalName: 'capabilities.loop.planner',
    tool: loopRuntime.plannerTool,
    model: loopRuntime.plannerModel,
    agent: loopRuntime.plannerAgent,
  }, config)
  const executor = createConfiguredProvider({
    logicalName: 'capabilities.loop.executor',
    tool: loopRuntime.executorTool,
    model: loopRuntime.executorModel,
    agent: loopRuntime.executorAgent,
  }, config)
  const autoCommitProvider = createConfiguredProvider(resolveAutoCommitProviderBinding({
    autoCommitModel: loopRuntime.autoCommitModel,
    executorTool: loopRuntime.executorTool,
    executorModel: loopRuntime.executorModel,
    executorAgent: loopRuntime.executorAgent,
  }), config)
  const planningContext = await planningRouter.createPlanContext({
    itemKey: planningItemKey,
    title: session.goal,
  })
  const planningContextBlock = buildPlanningContextBlock(planningContext)

  if (!session.plan || session.plan.length === 0) {
    session.plan = await generateLoopPlan(
      planner,
      session.goal,
      session.prdPath,
      session.stages,
      planningContextBlock
    )
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
    session.artifacts.workspacePath || ctx.cwd,
    loopRuntime,
    planner,
    executor,
    autoCommitProvider,
    notificationRouter,
    config.integrations.notifications,
    stateManager,
    commandSafety
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

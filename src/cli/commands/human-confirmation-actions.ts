import { randomBytes } from 'crypto'
import { join } from 'path'
import { createCapabilityContext } from '../../core/capability/context.js'
import { getTypedCapability } from '../../core/capability/registry.js'
import { runCapability } from '../../core/capability/runner.js'
import { createDefaultCapabilityRegistry } from '../../capabilities/index.js'
import type {
  DiscussCapabilityInput,
  DiscussExecutionResult,
  DiscussPreparedInput,
  DiscussSummaryOutput,
} from '../../capabilities/discuss/types.js'
import {
  findLatestPendingHumanConfirmationInQueue,
  loadHumanConfirmationItems,
  syncSessionHumanConfirmationProjection,
  summarizeHumanConfirmationReason,
} from '../../capabilities/loop/domain/human-confirmation.js'
import { StateManager } from '../../state/state-manager.js'
import type { DiscussSession, HumanConfirmationItem, LoopSession } from '../../state/types.js'

export interface ConfirmationDecisionOptions {
  approve?: boolean
  reject?: boolean
  reason?: string
  extraInstruction?: string
  config?: string
}

interface ConfirmationDecisionResult {
  resolvedItem: HumanConfirmationItem
  followUpItem?: HumanConfirmationItem
  discussionSessionId?: string
  discussionOutputPath?: string
}

function generateHumanConfirmationId(): string {
  return randomBytes(6).toString('hex')
}

function uniqueArtifacts(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.trim().length > 0))]
}

function buildAutoDiscussTopic(loopSession: LoopSession, pendingItem: HumanConfirmationItem, rejectReason: string): string {
  return [
    `请围绕当前暂停项给出继续还是不继续的建议。`,
    `目标：${loopSession.goal}`,
    `阶段：${pendingItem.stage}`,
    pendingItem.summary ? `当前摘要：${pendingItem.summary}` : '',
    `当前问题：${pendingItem.reason}`,
    pendingItem.artifacts.length > 0 ? `证据文件：${pendingItem.artifacts.join(', ')}` : '',
    `人工驳回理由：${rejectReason}`,
    '请给出简短结论，并明确说明建议继续还是建议先修正后再继续。',
  ].filter(Boolean).join('\n')
}

function guessRecommendation(text: string): 'approve' | 'reject' {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('request changes')
    || normalized.includes('revise')
    || normalized.includes('不要继续')
    || normalized.includes('先修')
    || normalized.includes('阻塞')
    || normalized.includes('风险')
  ) {
    return 'reject'
  }

  if (
    normalized.includes('approved')
    || normalized.includes('通过')
    || normalized.includes('可继续')
    || normalized.includes('建议继续')
  ) {
    return 'approve'
  }

  return 'reject'
}

async function runAutoDiscuss(cwd: string, configPath: string | undefined, topic: string, outputPath: string): Promise<{
  status: 'completed' | 'failed'
  session?: DiscussSession
  outputPath?: string
  summary: string
}> {
  const stateManager = new StateManager(cwd)
  await stateManager.initDiscussions()
  const before = await stateManager.listDiscussSessions()
  const beforeIds = new Set(before.map((session) => session.id))

  const registry = createDefaultCapabilityRegistry()
  const capability = getTypedCapability<
    DiscussCapabilityInput,
    DiscussPreparedInput,
    DiscussExecutionResult,
    DiscussSummaryOutput
  >(registry, 'discuss')
  const ctx = createCapabilityContext({
    cwd,
    configPath,
  })

  try {
    const { result } = await runCapability(capability, {
      topic,
      options: {
        interactive: false,
        output: outputPath,
        format: 'markdown',
      },
    }, ctx)

    const after = await stateManager.listDiscussSessions()
    const session = after.find((candidate) => !beforeIds.has(candidate.id)) || after[0]
    return {
      status: result.status === 'completed' ? 'completed' : 'failed',
      session,
      outputPath: result.status === 'completed' ? outputPath : undefined,
      summary: result.payload?.summary || 'Discussion failed.',
    }
  } catch (error) {
    return {
      status: 'failed',
      summary: error instanceof Error ? error.message : String(error),
    }
  }
}

function latestDiscussConclusion(session: DiscussSession | undefined): string {
  if (!session || session.rounds.length === 0) {
    return 'Automatic discussion did not produce a conclusion.'
  }

  return session.rounds[session.rounds.length - 1]?.conclusion || 'Automatic discussion did not produce a conclusion.'
}

function mergeHumanConfirmation(loopSession: LoopSession, item: HumanConfirmationItem): void {
  const existingIndex = loopSession.humanConfirmations.findIndex((candidate) => candidate.id === item.id)
  if (existingIndex >= 0) {
    loopSession.humanConfirmations[existingIndex] = item
    return
  }
  loopSession.humanConfirmations.push(item)
}

async function ensureSessionHumanConfirmations(loopSession: LoopSession): Promise<void> {
  if (loopSession.humanConfirmations.length > 0) {
    return
  }

  const legacyItems = await loadHumanConfirmationItems(loopSession.artifacts.humanConfirmationPath)
  const sessionItems = legacyItems.filter((item) => item.sessionId === loopSession.id)
  if (sessionItems.length > 0) {
    loopSession.humanConfirmations = sessionItems
  }
}

function requireDecisionMode(options: ConfirmationDecisionOptions): { approve: true } | { approve: false; rejectReason: string } {
  if (options.approve && options.reject) {
    throw new Error('Choose either --approve or --reject, not both.')
  }
  if (!options.approve && !options.reject) {
    throw new Error('Choose one decision: --approve or --reject.')
  }
  if (options.reject && !options.reason?.trim()) {
    throw new Error('--reject requires --reason.')
  }
  if (options.approve) {
    return { approve: true as const }
  }
  return {
    approve: false as const,
    rejectReason: options.reason!.trim(),
  }
}

export async function applyLoopConfirmationDecision(
  cwd: string,
  loopSession: LoopSession,
  options: ConfirmationDecisionOptions
): Promise<ConfirmationDecisionResult> {
  const decision = requireDecisionMode(options)
  await ensureSessionHumanConfirmations(loopSession)
  const pendingItem = findLatestPendingHumanConfirmationInQueue(loopSession.humanConfirmations, loopSession.id)

  if (!pendingItem) {
    throw new Error(`Loop session ${loopSession.id} has no pending human confirmation.`)
  }

  const now = new Date()
  const extraInstruction = options.extraInstruction?.trim()
  const decisionRationale = decision.approve
    ? [
        'Approved via confirm command.',
        extraInstruction ? `Operator instruction: ${extraInstruction}` : '',
      ].filter(Boolean).join(' ')
    : [
        decision.rejectReason,
        extraInstruction ? `Operator instruction: ${extraInstruction}` : '',
      ].filter(Boolean).join('\n')
  const resolvedItem: HumanConfirmationItem = {
    ...pendingItem,
    decision: decision.approve ? 'approved' : 'rejected',
    status: decision.approve ? 'approved' : 'rejected',
    rationale: decisionRationale,
    updatedAt: now,
  }

  mergeHumanConfirmation(loopSession, resolvedItem)

  let followUpItem: HumanConfirmationItem | undefined
  if (!decision.approve) {
    const rejectReason = decisionRationale
    const discussionOutputPath = join(loopSession.artifacts.sessionDir, `human-confirmation-${pendingItem.id}-discussion.md`)
    const discussion = await runAutoDiscuss(
      cwd,
      options.config,
      buildAutoDiscussTopic(loopSession, pendingItem, rejectReason),
      discussionOutputPath
    )

    const followUpSource = discussion.status === 'completed'
      ? latestDiscussConclusion(discussion.session)
      : `Automatic discussion failed: ${discussion.summary}`
    const condensed = summarizeHumanConfirmationReason(followUpSource)
    followUpItem = {
      id: generateHumanConfirmationId(),
      sessionId: loopSession.id,
      stage: pendingItem.stage,
      status: 'pending',
      decision: 'pending',
      summary: discussion.status === 'completed'
        ? 'Discussion finished. Review the updated recommendation.'
        : 'Automatic discussion failed. Manual follow-up is required.',
      recommendation: discussion.status === 'completed'
        ? guessRecommendation(followUpSource)
        : 'reject',
      reason: condensed.reason || followUpSource,
      rationale: rejectReason,
      artifacts: uniqueArtifacts([
        ...pendingItem.artifacts,
        ...(discussion.outputPath ? [discussion.outputPath] : []),
      ]),
      nextAction: discussion.status === 'completed'
        ? 'Approve to continue or reject with another reason'
        : 'Review the failed discussion and decide the next step manually',
      parentId: pendingItem.id,
      discussionSessionId: discussion.session?.id,
      discussionOutputPath: discussion.outputPath,
      createdAt: now,
      updatedAt: now,
    }
    mergeHumanConfirmation(loopSession, followUpItem)
  }

  await syncSessionHumanConfirmationProjection(
    loopSession.artifacts.humanConfirmationPath,
    loopSession.id,
    loopSession.humanConfirmations.filter((item) => item.sessionId === loopSession.id)
  )

  loopSession.updatedAt = now
  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  await stateManager.saveLoopSession(loopSession)

  return {
    resolvedItem,
    followUpItem,
    discussionSessionId: followUpItem?.discussionSessionId,
    discussionOutputPath: followUpItem?.discussionOutputPath,
  }
}

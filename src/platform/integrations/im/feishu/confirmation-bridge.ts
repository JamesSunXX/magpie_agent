import { applyLoopConfirmationDecision } from '../../../../cli/commands/human-confirmation-actions.js'
import { StateManager } from '../../../../state/state-manager.js'
import { appendImEvent } from '../runtime.js'
import type { ConfirmationAction } from '../types.js'

export async function handleConfirmationAction(cwd: string, input: {
  actorOpenId: string
  whitelist: string[]
  action: ConfirmationAction
  sessionId: string
  confirmationId: string
  threadKey: string
  chatId: string
  rejectionReason?: string
  extraInstruction?: string
}): Promise<{
  status: 'applied' | 'rejected'
  decision?: 'approved' | 'rejected' | 'revise'
  reason?: string
}> {
  if (!input.whitelist.includes(input.actorOpenId)) {
    await appendImEvent(cwd, {
      type: 'confirmation_permission_denied',
      actorOpenId: input.actorOpenId,
      action: input.action,
      sessionId: input.sessionId,
      confirmationId: input.confirmationId,
      threadKey: input.threadKey,
      chatId: input.chatId,
    })
    return {
      status: 'rejected',
      reason: `Actor ${input.actorOpenId} is not allowed to approve confirmations.`,
    }
  }

  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  const loopSession = await stateManager.loadLoopSession(input.sessionId)
  if (!loopSession) {
    return {
      status: 'rejected',
      reason: `Loop session ${input.sessionId} not found.`,
    }
  }

  const pending = loopSession.humanConfirmations.find((item) => item.id === input.confirmationId && item.decision === 'pending')
  if (!pending) {
    await appendImEvent(cwd, {
      type: 'confirmation_missing',
      actorOpenId: input.actorOpenId,
      action: input.action,
      sessionId: input.sessionId,
      confirmationId: input.confirmationId,
      threadKey: input.threadKey,
      chatId: input.chatId,
    })
    return {
      status: 'rejected',
      reason: `Pending confirmation ${input.confirmationId} not found.`,
    }
  }

  const result = await applyLoopConfirmationDecision(cwd, loopSession, input.action === 'approve_confirmation'
    ? {
        approve: true,
        extraInstruction: input.extraInstruction,
      }
    : {
        reject: true,
        reason: input.rejectionReason || 'Rejected from Feishu.',
        extraInstruction: input.extraInstruction,
      })
  const decision = result.resolvedItem.decision === 'pending'
    ? 'rejected'
    : result.resolvedItem.decision

  await appendImEvent(cwd, {
    type: 'confirmation_permission_applied',
    actorOpenId: input.actorOpenId,
    action: input.action,
    sessionId: input.sessionId,
    confirmationId: input.confirmationId,
    threadKey: input.threadKey,
    chatId: input.chatId,
    decision,
  })

  return {
    status: 'applied',
    decision,
  }
}

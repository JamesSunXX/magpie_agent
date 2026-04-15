export type ConfirmationAction =
  | 'approve_confirmation'
  | 'reject_confirmation'

export interface ConfirmationActionEvent {
  kind: 'confirmation_action'
  action: ConfirmationAction
  actorOpenId: string
  sessionId: string
  confirmationId: string
  threadKey: string
  chatId: string
  rejectionReason?: string
  extraInstruction?: string
}

export type ImInboundEvent = ConfirmationActionEvent

export interface ImServerStatus {
  providerId: string
  status: 'running' | 'stopped'
  port: number
  path: string
  updatedAt: string
}

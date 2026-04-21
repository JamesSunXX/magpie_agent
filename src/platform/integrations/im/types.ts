export type ConfirmationAction =
  | 'approve_confirmation'
  | 'reject_confirmation'

export interface ConfirmationActionEvent {
  kind: 'confirmation_action'
  action: ConfirmationAction
  eventId?: string
  actorOpenId: string
  sessionId: string
  confirmationId: string
  threadKey: string
  chatId: string
  rejectionReason?: string
  extraInstruction?: string
}

export interface TaskCommandEvent {
  kind: 'task_command'
  eventId?: string
  actorOpenId: string
  sourceMessageId: string
  threadKey: string
  chatId: string
  text: string
}

export interface TaskFormSubmissionEvent {
  kind: 'task_form_submission'
  eventId?: string
  actorOpenId: string
  threadKey: string
  chatId: string
  formValues: {
    taskType?: string
    goal?: string
    prdPath?: string
    priority?: string
  }
}

export type ImInboundEvent =
  | ConfirmationActionEvent
  | TaskCommandEvent
  | TaskFormSubmissionEvent

export interface ImServerStatus {
  providerId: string
  status: 'running' | 'stopped'
  port: number
  path: string
  processId?: number
  updatedAt: string
}

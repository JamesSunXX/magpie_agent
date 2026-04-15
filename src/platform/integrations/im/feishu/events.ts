import type { ConfirmationActionEvent } from '../types.js'

function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`Invalid Feishu callback payload: missing ${field}`)
}

export function parseFeishuEvent(payload: unknown): ConfirmationActionEvent {
  const header = (payload as { header?: { event_id?: unknown } })?.header
  const event = (payload as {
    event?: {
      operator?: { open_id?: unknown }
      action?: { value?: Record<string, unknown>; form_value?: Record<string, unknown> }
      context?: { open_message_id?: unknown; open_chat_id?: unknown }
    }
  })?.event

  const value = event?.action?.value || {}
  const formValue = event?.action?.form_value || {}
  const action = requireString(value.action, 'event.action.value.action')

  if (action !== 'approve_confirmation' && action !== 'reject_confirmation') {
    throw new Error(`Invalid Feishu callback payload: unsupported action ${action}`)
  }

  return {
    kind: 'confirmation_action',
    action,
    eventId: typeof header?.event_id === 'string' ? header.event_id : undefined,
    actorOpenId: requireString(event?.operator?.open_id, 'event.operator.open_id'),
    sessionId: requireString(value.session_id, 'event.action.value.session_id'),
    confirmationId: requireString(value.confirmation_id, 'event.action.value.confirmation_id'),
    threadKey: requireString(event?.context?.open_message_id, 'event.context.open_message_id'),
    chatId: requireString(event?.context?.open_chat_id, 'event.context.open_chat_id'),
    rejectionReason: typeof formValue.rejection_reason === 'string'
      ? formValue.rejection_reason
      : typeof value.rejection_reason === 'string'
        ? value.rejection_reason
        : undefined,
    extraInstruction: typeof formValue.extra_instruction === 'string'
      ? formValue.extra_instruction
      : typeof value.extra_instruction === 'string'
        ? value.extra_instruction
        : undefined,
  }
}

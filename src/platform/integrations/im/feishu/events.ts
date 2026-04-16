import type { ConfirmationActionEvent, ImInboundEvent, TaskCommandEvent } from '../types.js'

function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`Invalid Feishu callback payload: missing ${field}`)
}

function parseConfirmationActionEvent(payload: unknown): ConfirmationActionEvent {
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

function parseTaskCommandEvent(payload: unknown): TaskCommandEvent {
  const header = (payload as { header?: { event_id?: unknown } })?.header
  const event = (payload as {
    event?: {
      sender?: { sender_id?: { open_id?: unknown } }
      message?: {
        message_id?: unknown
        chat_id?: unknown
        message_type?: unknown
        content?: unknown
      }
    }
  })?.event

  const messageType = requireString(event?.message?.message_type, 'event.message.message_type')
  if (messageType !== 'text') {
    throw new Error(`Invalid Feishu callback payload: unsupported message_type ${messageType}`)
  }

  const rawContent = requireString(event?.message?.content, 'event.message.content')
  let content: { text?: unknown }
  try {
    content = JSON.parse(rawContent) as { text?: unknown }
  } catch {
    throw new Error('Invalid Feishu callback payload: malformed event.message.content')
  }

  return {
    kind: 'task_command',
    eventId: typeof header?.event_id === 'string' ? header.event_id : undefined,
    actorOpenId: requireString(event?.sender?.sender_id?.open_id, 'event.sender.sender_id.open_id'),
    sourceMessageId: requireString(event?.message?.message_id, 'event.message.message_id'),
    chatId: requireString(event?.message?.chat_id, 'event.message.chat_id'),
    text: requireString(content.text, 'event.message.content.text'),
  }
}

export function parseFeishuEvent(payload: unknown): ImInboundEvent {
  const eventType = (payload as { header?: { event_type?: unknown } })?.header?.event_type
  if (eventType === 'im.message.receive_v1') {
    return parseTaskCommandEvent(payload)
  }

  return parseConfirmationActionEvent(payload)
}

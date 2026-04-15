import { describe, expect, it } from 'vitest'
import { parseFeishuEvent } from '../../../src/platform/integrations/im/feishu/events.js'

describe('parseFeishuEvent', () => {
  it('normalizes a card action callback into a confirmation action event', () => {
    const normalized = parseFeishuEvent({
      header: { event_type: 'im.message.action.trigger' },
      event: {
        operator: { open_id: 'ou_operator' },
        action: {
          value: {
            action: 'approve_confirmation',
            session_id: 'loop-123',
            confirmation_id: 'confirm-1',
          },
        },
        context: {
          open_message_id: 'om_root',
          open_chat_id: 'oc_chat',
        },
      },
    })

    expect(normalized).toEqual({
      kind: 'confirmation_action',
      action: 'approve_confirmation',
      actorOpenId: 'ou_operator',
      sessionId: 'loop-123',
      confirmationId: 'confirm-1',
      threadKey: 'om_root',
      chatId: 'oc_chat',
      rejectionReason: undefined,
      extraInstruction: undefined,
    })
  })

  it('keeps optional rejection reason and extra instruction fields', () => {
    const normalized = parseFeishuEvent({
      header: { event_type: 'im.message.action.trigger' },
      event: {
        operator: { open_id: 'ou_operator' },
        action: {
          value: {
            action: 'reject_confirmation',
            session_id: 'loop-123',
            confirmation_id: 'confirm-1',
            rejection_reason: 'Need stronger rollback evidence',
            extra_instruction: 'Add a rollback rehearsal before continuing.',
          },
        },
        context: {
          open_message_id: 'om_root',
          open_chat_id: 'oc_chat',
        },
      },
    })

    expect(normalized).toEqual({
      kind: 'confirmation_action',
      action: 'reject_confirmation',
      actorOpenId: 'ou_operator',
      sessionId: 'loop-123',
      confirmationId: 'confirm-1',
      threadKey: 'om_root',
      chatId: 'oc_chat',
      rejectionReason: 'Need stronger rollback evidence',
      extraInstruction: 'Add a rollback rehearsal before continuing.',
    })
  })
})

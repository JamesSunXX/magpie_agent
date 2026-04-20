import { describe, expect, it } from 'vitest'
import { parseFeishuEvent } from '../../../src/platform/integrations/im/feishu/events.js'

describe('parseFeishuEvent', () => {
  it('normalizes a Feishu text message into a task command event', () => {
    const normalized = parseFeishuEvent({
      header: {
        event_id: 'evt-task-1',
        event_type: 'im.message.receive_v1',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_requester',
          },
        },
        message: {
          message_id: 'om_source',
          chat_id: 'oc_chat',
          message_type: 'text',
          content: JSON.stringify({
            text: '/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md',
          }),
        },
      },
    })

    expect(normalized).toEqual({
      kind: 'task_command',
      eventId: 'evt-task-1',
      actorOpenId: 'ou_requester',
      sourceMessageId: 'om_source',
      chatId: 'oc_chat',
      text: '/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md',
    })
  })

  it('rejects unknown callback event types with a stable error', () => {
    expect(() => parseFeishuEvent({
      header: {
        event_type: 'im.unknown.callback',
      },
      event: {},
    })).toThrow('unsupported event_type im.unknown.callback')
  })

  it('rejects unsupported Feishu message payloads', () => {
    expect(() => parseFeishuEvent({
      header: {
        event_type: 'im.message.receive_v1',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_requester',
          },
        },
        message: {
          message_id: 'om_source',
          chat_id: 'oc_chat',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img_1' }),
        },
      },
    })).toThrow('unsupported message_type image')
  })

  it('rejects malformed Feishu message content JSON', () => {
    expect(() => parseFeishuEvent({
      header: {
        event_type: 'im.message.receive_v1',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_requester',
          },
        },
        message: {
          message_id: 'om_source',
          chat_id: 'oc_chat',
          message_type: 'text',
          content: '{not-json',
        },
      },
    })).toThrow('malformed event.message.content')
  })

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
          },
          form_value: {
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

  it('normalizes a task form submission callback into a task form event', () => {
    const normalized = parseFeishuEvent({
      header: {
        event_id: 'evt-form-1',
        event_type: 'im.message.action.trigger',
      },
      event: {
        operator: { open_id: 'ou_requester' },
        action: {
          value: {
            action: 'submit_task_form',
          },
          form_value: {
            type: 'formal',
            goal: 'Deliver payment retry flow',
            prd: 'docs/plans/payment-retry.md',
            priority: 'high',
          },
        },
        context: {
          open_message_id: 'om_form_root',
          open_chat_id: 'oc_chat',
        },
      },
    })

    expect(normalized).toEqual({
      kind: 'task_form_submission',
      eventId: 'evt-form-1',
      actorOpenId: 'ou_requester',
      threadKey: 'om_form_root',
      chatId: 'oc_chat',
      formValues: {
        taskType: 'formal',
        goal: 'Deliver payment retry flow',
        prdPath: 'docs/plans/payment-retry.md',
        priority: 'high',
      },
    })
  })

  it('keeps compatibility with legacy task_type form submissions', () => {
    const normalized = parseFeishuEvent({
      header: {
        event_id: 'evt-form-legacy',
        event_type: 'im.message.action.trigger',
      },
      event: {
        operator: { open_id: 'ou_requester' },
        action: {
          value: {
            action: 'submit_task_form',
          },
          form_value: {
            task_type: 'small',
            goal: 'Fix login timeout',
            prd: 'docs/plans/login-timeout.md',
          },
        },
        context: {
          open_message_id: 'om_form_root',
          open_chat_id: 'oc_chat',
        },
      },
    })

    expect(normalized).toEqual({
      kind: 'task_form_submission',
      eventId: 'evt-form-legacy',
      actorOpenId: 'ou_requester',
      threadKey: 'om_form_root',
      chatId: 'oc_chat',
      formValues: {
        taskType: 'small',
        goal: 'Fix login timeout',
        prdPath: 'docs/plans/login-timeout.md',
        priority: undefined,
      },
    })
  })
})

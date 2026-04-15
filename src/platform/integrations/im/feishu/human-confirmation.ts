import { FeishuImClient } from './client.js'
import {
  loadThreadMappingBySession,
  saveThreadMapping,
  type ThreadMappingRecord,
} from '../thread-mapping.js'
import type { MagpieConfig } from '../../../../config/types.js'

function buildRootSummary(input: {
  capability: ThreadMappingRecord['capability']
  sessionId: string
  title: string
}): string {
  return [
    `Magpie ${input.capability} task`,
    `Session: ${input.sessionId}`,
    `Title: ${input.title}`,
  ].join('\n')
}

function buildConfirmationCard(input: {
  title: string
  summary: string
  sessionId: string
  confirmationId: string
}): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: input.title,
      },
      template: 'orange',
    },
    elements: [
      {
        tag: 'markdown',
        content: input.summary,
      },
      {
        tag: 'input',
        name: 'rejection_reason',
        placeholder: {
          tag: 'plain_text',
          content: 'Reject reason',
        },
      },
      {
        tag: 'input',
        name: 'extra_instruction',
        placeholder: {
          tag: 'plain_text',
          content: 'Optional continuation instruction',
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'Approve',
            },
            type: 'primary',
            value: {
              action: 'approve_confirmation',
              session_id: input.sessionId,
              confirmation_id: input.confirmationId,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'Reject',
            },
            type: 'default',
            value: {
              action: 'reject_confirmation',
              session_id: input.sessionId,
              confirmation_id: input.confirmationId,
            },
          },
        ],
      },
    ],
  }
}

export async function publishFeishuHumanConfirmation(cwd: string, input: {
  app_id: string
  app_secret: string
  default_chat_id: string
  capability: ThreadMappingRecord['capability']
  sessionId: string
  title: string
  summary: string
  confirmationId: string
}): Promise<ThreadMappingRecord> {
  const client = new FeishuImClient({
    appId: input.app_id,
    appSecret: input.app_secret,
  })

  let mapping = await loadThreadMappingBySession(cwd, input.capability, input.sessionId)
  if (!mapping) {
    const root = await client.sendRootTextMessage(input.default_chat_id, buildRootSummary({
      capability: input.capability,
      sessionId: input.sessionId,
      title: input.title,
    }))
    mapping = await saveThreadMapping(cwd, {
      threadId: root.messageId,
      rootMessageId: root.messageId,
      chatId: input.default_chat_id,
      capability: input.capability,
      sessionId: input.sessionId,
      status: 'active',
    })
  }

  await client.replyInteractiveCard(mapping.rootMessageId, buildConfirmationCard({
    title: input.title,
    summary: input.summary,
    sessionId: input.sessionId,
    confirmationId: input.confirmationId,
  }))

  return saveThreadMapping(cwd, {
    ...mapping,
    status: 'paused_for_human',
    lastEventId: input.confirmationId,
  })
}

export async function publishFeishuHumanConfirmationFromConfig(
  cwd: string,
  config: MagpieConfig,
  input: {
    capability: ThreadMappingRecord['capability']
    sessionId: string
    title: string
    summary: string
    confirmationId: string
  }
): Promise<ThreadMappingRecord | null> {
  const integration = config.integrations.im
  if (!integration?.enabled || !integration.default_provider) {
    return null
  }

  const provider = integration.providers?.[integration.default_provider]
  if (!provider || provider.type !== 'feishu-app') {
    return null
  }

  return publishFeishuHumanConfirmation(cwd, {
    app_id: provider.app_id,
    app_secret: provider.app_secret,
    default_chat_id: provider.default_chat_id,
    capability: input.capability,
    sessionId: input.sessionId,
    title: input.title,
    summary: input.summary,
    confirmationId: input.confirmationId,
  })
}

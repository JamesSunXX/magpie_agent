import type { MagpieConfig } from '../../../../config/types.js'
import { loadThreadMappingBySession, saveThreadMapping } from '../thread-mapping.js'
import { FeishuImClient } from './client.js'

export async function publishFeishuTaskStatusFromConfig(
  cwd: string,
  config: MagpieConfig,
  input: {
    capability: 'loop' | 'harness'
    sessionId: string
    status: 'queued' | 'running' | 'paused_for_human' | 'completed' | 'failed'
    title: string
    summary: string
  }
): Promise<boolean> {
  const integration = config.integrations.im
  if (!integration?.enabled || !integration.default_provider) {
    return false
  }

  const provider = integration.providers?.[integration.default_provider]
  if (!provider || provider.type !== 'feishu-app') {
    return false
  }

  const mapping = await loadThreadMappingBySession(cwd, input.capability, input.sessionId)
  if (!mapping) {
    return false
  }

  const client = new FeishuImClient({
    appId: provider.app_id,
    appSecret: provider.app_secret,
  })

  await client.replyTextMessage(mapping.rootMessageId, [
    `${input.capability} ${input.status}`,
    `Title: ${input.title}`,
    input.summary,
  ].join('\n'))

  await saveThreadMapping(cwd, {
    ...mapping,
    status: input.status,
  })

  return true
}

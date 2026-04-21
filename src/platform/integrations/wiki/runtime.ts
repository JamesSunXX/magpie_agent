import type { MagpieConfigV2, FeishuWikiProviderConfig } from '../../config/types.js'
import { FeishuWikiClient } from './feishu/client.js'
import type { WikiNode, WikiDocument, WikiSyncResult } from './types.js'

export type { WikiNode, WikiDocument, WikiSyncResult }

/** Resolve the wiki provider config by id (or default). */
function resolveProvider(config: MagpieConfigV2, providerId?: string): FeishuWikiProviderConfig | null {
  const wiki = config.integrations?.wiki
  if (!wiki?.enabled || !wiki.providers) return null
  const id = providerId ?? wiki.default_provider
  if (!id) return null
  const provider = wiki.providers[id]
  if (!provider || provider.enabled === false) return null
  return provider as FeishuWikiProviderConfig
}

/** Create a FeishuWikiClient from config. Returns null if wiki is not configured. */
export function createWikiClient(config: MagpieConfigV2, providerId?: string): FeishuWikiClient | null {
  const provider = resolveProvider(config, providerId)
  if (!provider) return null
  return new FeishuWikiClient({ appId: provider.app_id, appSecret: provider.app_secret })
}

/**
 * Sync markdown content to a wiki document.
 * If nodeToken is provided, updates the existing doc.
 * Otherwise creates a new doc under the configured default space.
 */
export async function syncToWiki(
  config: MagpieConfigV2,
  opts: { title: string; content: string; nodeToken?: string; parentNodeToken?: string; providerId?: string },
): Promise<WikiSyncResult | null> {
  const provider = resolveProvider(config, opts.providerId)
  if (!provider) return null
  const client = new FeishuWikiClient({ appId: provider.app_id, appSecret: provider.app_secret })

  if (opts.nodeToken) {
    // Update existing doc
    const node = await client.getNode(opts.nodeToken)
    await client.updateDocContent(node.objToken, opts.content)
    return { nodeToken: node.nodeToken, objToken: node.objToken, url: `https://feishu.cn/wiki/${node.nodeToken}` }
  }

  // Create new doc
  const spaceId = provider.default_space_id
  if (!spaceId) throw new Error('wiki: default_space_id required to create new documents')
  const result = await client.createDoc(spaceId, opts.title, opts.parentNodeToken)
  await client.updateDocContent(result.objToken, opts.content)
  return result
}

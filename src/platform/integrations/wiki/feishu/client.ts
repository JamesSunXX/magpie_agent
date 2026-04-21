import type { WikiNode, WikiDocument, WikiSyncResult } from '../types.js'

function openApi(path: string): string {
  return `https://open.feishu.cn${path}`
}

async function readJson(response: Response): Promise<any> {
  return JSON.parse(await response.text())
}

/**
 * Feishu Wiki REST client.
 *
 * Scopes required:
 *   wiki:node:read   — read space node info
 *   wiki:wiki        — read/write/manage wiki
 *   wiki:wiki:readonly — read-only fallback
 *
 * Uses tenant_access_token, same auth model as FeishuImClient.
 */
export class FeishuWikiClient {
  constructor(private readonly options: { appId: string; appSecret: string }) {}

  // ── auth ──────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const res = await fetch(openApi('/open-apis/auth/v3/tenant_access_token/internal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }),
    })
    if (!res.ok) throw new Error(`Feishu token request failed: HTTP ${res.status}`)
    const data = await readJson(res)
    const token = data?.tenant_access_token
    if (typeof token !== 'string' || !token) throw new Error('Missing tenant_access_token')
    return token
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' }
  }

  // ── wiki node ─────────────────────────────────────────────────────

  /** Get a single wiki node by token. */
  async getNode(nodeToken: string): Promise<WikiNode> {
    const headers = await this.authHeaders()
    const res = await fetch(openApi(`/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`), { headers })
    if (!res.ok) throw new Error(`getNode failed: HTTP ${res.status}`)
    const data = await readJson(res)
    const node = data?.data?.node
    if (!node) throw new Error('getNode: missing data.node')
    return mapNode(node)
  }

  /** List direct children of a wiki node. */
  async listChildren(spaceId: string, parentNodeToken?: string): Promise<WikiNode[]> {
    const headers = await this.authHeaders()
    const params = new URLSearchParams()
    if (parentNodeToken) params.set('parent_node_token', parentNodeToken)
    params.set('page_size', '50')
    const res = await fetch(openApi(`/open-apis/wiki/v2/spaces/${spaceId}/nodes?${params}`), { headers })
    if (!res.ok) throw new Error(`listChildren failed: HTTP ${res.status}`)
    const data = await readJson(res)
    return (data?.data?.items ?? []).map(mapNode)
  }

  // ── docx content ──────────────────────────────────────────────────

  /** Read document content (docx block model). */
  async getDocContent(objToken: string): Promise<WikiDocument> {
    const headers = await this.authHeaders()
    // Get document meta + blocks in one call
    const res = await fetch(openApi(`/open-apis/docx/v1/documents/${objToken}`), { headers })
    if (!res.ok) throw new Error(`getDocContent meta failed: HTTP ${res.status}`)
    const meta = await readJson(res)
    const doc = meta?.data?.document
    if (!doc) throw new Error('getDocContent: missing data.document')

    const blocksRes = await fetch(openApi(`/open-apis/docx/v1/documents/${objToken}/blocks?page_size=500`), { headers })
    if (!blocksRes.ok) throw new Error(`getDocContent blocks failed: HTTP ${blocksRes.status}`)
    const blocksData = await readJson(blocksRes)

    return {
      nodeToken: '',
      objToken: doc.document_id ?? objToken,
      title: doc.title ?? '',
      body: blocksData?.data?.items ?? [],
    }
  }

  /** Create a new docx node under a wiki space. Returns the new node info. */
  async createDoc(spaceId: string, title: string, parentNodeToken?: string): Promise<WikiSyncResult> {
    const headers = await this.authHeaders()
    const body: Record<string, unknown> = {
      obj_type: 'docx',
      title,
    }
    if (parentNodeToken) body.parent_node_token = parentNodeToken
    const res = await fetch(openApi(`/open-apis/wiki/v2/spaces/${spaceId}/nodes`), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`createDoc failed: HTTP ${res.status}`)
    const data = await readJson(res)
    const node = data?.data?.node
    if (!node) throw new Error('createDoc: missing data.node')
    return {
      nodeToken: node.node_token,
      objToken: node.obj_token,
      url: `https://feishu.cn/wiki/${node.node_token}`,
    }
  }

  /**
   * Replace the body of an existing docx document with markdown-like text blocks.
   * Uses the batch-update blocks API to clear and rewrite content.
   */
  async updateDocContent(objToken: string, markdownContent: string): Promise<void> {
    const headers = await this.authHeaders()

    // Get existing blocks to find the document block (first block = page block)
    const blocksRes = await fetch(openApi(`/open-apis/docx/v1/documents/${objToken}/blocks?page_size=500`), { headers })
    if (!blocksRes.ok) throw new Error(`updateDocContent list blocks failed: HTTP ${blocksRes.status}`)
    const blocksData = await readJson(blocksRes)
    const items: any[] = blocksData?.data?.items ?? []

    // Delete all child blocks of the page block (index 0 is the page itself)
    const childBlockIds = items.slice(1).map((b: any) => b.block_id).filter(Boolean)
    if (childBlockIds.length > 0) {
      const delRes = await fetch(openApi(`/open-apis/docx/v1/documents/${objToken}/blocks/batch_delete`), {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ block_ids: childBlockIds }),
      })
      // Non-critical: some blocks may already be gone
      if (!delRes.ok) {
        const errBody = await readJson(delRes).catch(() => null)
        console.warn(`updateDocContent batch_delete non-fatal: HTTP ${delRes.status}`, errBody)
      }
    }

    // Insert new content as text blocks under the page block
    const pageBlockId = items[0]?.block_id
    if (!pageBlockId) throw new Error('updateDocContent: no page block found')

    const textBlocks = markdownContent.split('\n').map((line) => ({
      block_type: 2, // text block
      text: {
        elements: [{ text_run: { content: line } }],
      },
    }))

    if (textBlocks.length === 0) return

    const createRes = await fetch(openApi(`/open-apis/docx/v1/documents/${objToken}/blocks/${pageBlockId}/children`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ children: textBlocks, index: 0 }),
    })
    if (!createRes.ok) throw new Error(`updateDocContent create children failed: HTTP ${createRes.status}`)
  }
}

function mapNode(raw: any): WikiNode {
  return {
    nodeToken: raw.node_token ?? '',
    spaceId: raw.space_id ?? '',
    objToken: raw.obj_token ?? '',
    objType: raw.obj_type ?? '',
    parentNodeToken: raw.parent_node_token ?? '',
    title: raw.title ?? '',
    hasChild: raw.has_child ?? false,
  }
}

function joinOpenApi(path: string): string {
  return `https://open.feishu.cn${path}`
}

async function readJson(response: Response): Promise<any> {
  return JSON.parse(await response.text())
}

export class FeishuImClient {
  constructor(private readonly options: { appId: string; appSecret: string }) {}

  private async getTenantAccessToken(): Promise<string> {
    const response = await fetch(joinOpenApi('/open-apis/auth/v3/tenant_access_token/internal'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: this.options.appId,
        app_secret: this.options.appSecret,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to get Feishu tenant access token: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const token = data?.tenant_access_token
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Failed to get Feishu tenant access token: missing tenant_access_token')
    }

    return token
  }

  async sendRootTextMessage(chatId: string, text: string): Promise<{ messageId: string }> {
    const token = await this.getTenantAccessToken()
    const response = await fetch(joinOpenApi('/open-apis/im/v1/messages?receive_id_type=chat_id'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create Feishu root message: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const messageId = data?.data?.message_id
    if (typeof messageId !== 'string' || messageId.trim().length === 0) {
      throw new Error('Failed to create Feishu root message: missing data.message_id')
    }

    return { messageId }
  }

  async replyInteractiveCard(messageId: string, card: Record<string, unknown>): Promise<{ messageId: string }> {
    const token = await this.getTenantAccessToken()
    const response = await fetch(joinOpenApi(`/open-apis/im/v1/messages/${messageId}/reply`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        msg_type: 'interactive',
        content: JSON.stringify(card),
        reply_in_thread: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to reply to Feishu thread: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const replyId = data?.data?.message_id
    if (typeof replyId !== 'string' || replyId.trim().length === 0) {
      throw new Error('Failed to reply to Feishu thread: missing data.message_id')
    }

    return { messageId: replyId }
  }

  async replyTextMessage(messageId: string, text: string): Promise<{ messageId: string }> {
    const token = await this.getTenantAccessToken()
    const response = await fetch(joinOpenApi(`/open-apis/im/v1/messages/${messageId}/reply`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text }),
        reply_in_thread: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to reply to Feishu thread: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const replyId = data?.data?.message_id
    if (typeof replyId !== 'string' || replyId.trim().length === 0) {
      throw new Error('Failed to reply to Feishu thread: missing data.message_id')
    }

    return { messageId: replyId }
  }
}

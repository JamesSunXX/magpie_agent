import { createReadStream } from 'fs'
import { basename } from 'path'

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

  /** Upload a file and return its file_key. */
  async uploadFile(filePath: string, fileType: 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' = 'stream'): Promise<string> {
    const token = await this.getTenantAccessToken()
    const form = new FormData()
    form.append('file_type', fileType)
    form.append('file_name', basename(filePath))
    form.append('file', await fileToBlob(filePath))

    const response = await fetch(joinOpenApi('/open-apis/im/v1/files'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })

    if (!response.ok) {
      throw new Error(`Failed to upload file to Feishu: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const fileKey = data?.data?.file_key
    if (typeof fileKey !== 'string' || fileKey.trim().length === 0) {
      throw new Error('Failed to upload file to Feishu: missing data.file_key')
    }

    return fileKey
  }

  /** Reply with a file attachment in a thread. */
  async replyFileMessage(messageId: string, filePath: string): Promise<{ messageId: string }> {
    const fileKey = await this.uploadFile(filePath)
    const token = await this.getTenantAccessToken()
    const response = await fetch(joinOpenApi(`/open-apis/im/v1/messages/${messageId}/reply`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
        reply_in_thread: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to reply file message: HTTP ${response.status}`)
    }

    const data = await readJson(response)
    const replyId = data?.data?.message_id
    if (typeof replyId !== 'string' || replyId.trim().length === 0) {
      throw new Error('Failed to reply file message: missing data.message_id')
    }

    return { messageId: replyId }
  }
}

async function fileToBlob(filePath: string): Promise<Blob> {
  const { readFile } = await import('fs/promises')
  const buffer = await readFile(filePath)
  return new Blob([buffer])
}

import type {
  FeishuProjectPlanningProviderConfig,
  PlanningArtifactSyncInput,
  PlanningArtifactSyncResult,
  PlanningContext,
  PlanningContextInput,
  PlanningProvider,
} from '../types.js'

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => stringifyValue(item)).filter(Boolean).join(', ')
  }
  if (!value || typeof value !== 'object') {
    return ''
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${stringifyValue(item)}`)
    .filter(line => !line.endsWith(': '))
    .join('\n')
}

function buildFeishuSummary(payload: unknown): string {
  const item = (payload as {
    data?: {
      item?: {
        item_key?: string
        title?: string
        status?: string
        fields?: Record<string, unknown>
      }
    }
  })?.data?.item

  if (!item) {
    return ''
  }

  const lines = [
    item.item_key ? `Item: ${item.item_key}` : '',
    item.title ? `Title: ${item.title}` : '',
    item.status ? `Status: ${item.status}` : '',
  ].filter(Boolean)

  const fieldsText = stringifyValue(item.fields).trim()
  if (fieldsText) {
    lines.push('', 'Fields:', fieldsText)
  }

  return lines.join('\n')
}

export class FeishuProjectPlanningProvider implements PlanningProvider {
  readonly id: string
  private readonly config: FeishuProjectPlanningProviderConfig

  constructor(id: string, config: FeishuProjectPlanningProviderConfig) {
    this.id = id
    this.config = config
  }

  async createPlanContext(input: PlanningContextInput): Promise<PlanningContext | null> {
    const projectKey = input.projectKey || this.config.project_key
      || (input.itemKey?.match(/^([A-Z][A-Z0-9]+)-\d+$/i)?.[1]?.toUpperCase())
    if (!projectKey) {
      return null
    }

    const url = input.itemKey
      ? joinUrl(this.config.base_url, `/project/${projectKey}/item/${input.itemKey}`)
      : joinUrl(this.config.base_url, `/project/${projectKey}`)

    let raw: unknown
    let summary: string | undefined

    if (input.itemKey) {
      const response = await fetch(joinUrl(this.config.base_url, `/open_api/project/${projectKey}/items/${input.itemKey}`), {
        method: 'GET',
        headers: {
          'X-App-Id': this.config.app_id,
          'X-App-Secret': this.config.app_secret,
        },
      })

      if (response.ok) {
        raw = await response.json()
        summary = buildFeishuSummary(raw)
      }
    }

    return {
      providerId: this.id,
      projectKey,
      itemKey: input.itemKey,
      title: input.title,
      url,
      summary,
      raw,
    }
  }

  async syncPlanArtifact(input: PlanningArtifactSyncInput): Promise<PlanningArtifactSyncResult> {
    const projectKey = input.projectKey || this.config.project_key
      || (input.itemKey?.match(/^([A-Z][A-Z0-9]+)-\d+$/i)?.[1]?.toUpperCase())
    if (!projectKey) {
      return { providerId: this.id, synced: false }
    }

    const url = input.itemKey
      ? joinUrl(this.config.base_url, `/open_api/project/${projectKey}/items/${input.itemKey}/comments`)
      : joinUrl(this.config.base_url, `/open_api/project/${projectKey}/plans`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': this.config.app_id,
        'X-App-Secret': this.config.app_secret,
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
      }),
    })

    return {
      providerId: this.id,
      synced: response.ok,
      url,
      raw: await response.text(),
    }
  }
}

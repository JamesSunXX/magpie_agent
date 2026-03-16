import type {
  JiraPlanningProviderConfig,
  PlanningArtifactSyncInput,
  PlanningArtifactSyncResult,
  PlanningContext,
  PlanningContextInput,
  PlanningProvider,
} from '../types.js'

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function toBasicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

function jiraRichTextToString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => jiraRichTextToString(item)).filter(Boolean).join('\n')
  }
  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as {
    text?: unknown
    content?: unknown
    attrs?: { text?: unknown }
  }

  const parts = [
    typeof record.text === 'string' ? record.text : '',
    typeof record.attrs?.text === 'string' ? record.attrs.text : '',
    jiraRichTextToString(record.content),
  ].filter(Boolean)

  return parts.join('\n')
}

function buildJiraSummary(payload: unknown): string {
  const issue = payload as {
    key?: string
    fields?: {
      summary?: string
      description?: unknown
      status?: { name?: string }
      issuetype?: { name?: string }
      labels?: string[]
    }
  }

  const lines = [
    issue.key ? `Key: ${issue.key}` : '',
    issue.fields?.summary ? `Summary: ${issue.fields.summary}` : '',
    issue.fields?.issuetype?.name ? `Type: ${issue.fields.issuetype.name}` : '',
    issue.fields?.status?.name ? `Status: ${issue.fields.status.name}` : '',
    issue.fields?.labels?.length ? `Labels: ${issue.fields.labels.join(', ')}` : '',
  ].filter(Boolean)

  const description = jiraRichTextToString(issue.fields?.description).trim()
  if (description) {
    lines.push('', 'Description:', description)
  }

  return lines.join('\n')
}

export class JiraPlanningProvider implements PlanningProvider {
  readonly id: string
  private readonly config: JiraPlanningProviderConfig

  constructor(id: string, config: JiraPlanningProviderConfig) {
    this.id = id
    this.config = config
  }

  async createPlanContext(input: PlanningContextInput): Promise<PlanningContext | null> {
    const projectKey = input.projectKey || this.config.project_key
    if (!projectKey) {
      return null
    }

    const url = input.itemKey
      ? joinUrl(this.config.base_url, `/browse/${input.itemKey}`)
      : joinUrl(this.config.base_url, `/jira/software/projects/${projectKey}`)

    let raw: unknown
    let summary: string | undefined

    if (input.itemKey) {
      const response = await fetch(joinUrl(this.config.base_url, `/rest/api/3/issue/${input.itemKey}`), {
        method: 'GET',
        headers: {
          Authorization: toBasicAuth(this.config.email, this.config.api_token),
          Accept: 'application/json',
        },
      })
      if (response.ok) {
        raw = await response.json()
        summary = buildJiraSummary(raw)
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
    if (!projectKey && !input.itemKey) {
      return { providerId: this.id, synced: false }
    }

    const url = input.itemKey
      ? joinUrl(this.config.base_url, `/rest/api/3/issue/${input.itemKey}/comment`)
      : joinUrl(this.config.base_url, `/rest/api/3/project/${projectKey}/properties/magpie-plan`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: toBasicAuth(this.config.email, this.config.api_token),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        body: input.title ? `${input.title}\n\n${input.body}` : input.body,
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

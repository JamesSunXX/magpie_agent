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

    return {
      providerId: this.id,
      projectKey,
      itemKey: input.itemKey,
      title: input.title,
      url: input.itemKey
        ? joinUrl(this.config.base_url, `/browse/${input.itemKey}`)
        : joinUrl(this.config.base_url, `/jira/software/projects/${projectKey}`),
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

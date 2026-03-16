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

export class FeishuProjectPlanningProvider implements PlanningProvider {
  readonly id: string
  private readonly config: FeishuProjectPlanningProviderConfig

  constructor(id: string, config: FeishuProjectPlanningProviderConfig) {
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
        ? joinUrl(this.config.base_url, `/project/${projectKey}/item/${input.itemKey}`)
        : joinUrl(this.config.base_url, `/project/${projectKey}`),
    }
  }

  async syncPlanArtifact(input: PlanningArtifactSyncInput): Promise<PlanningArtifactSyncResult> {
    const projectKey = input.projectKey || this.config.project_key
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

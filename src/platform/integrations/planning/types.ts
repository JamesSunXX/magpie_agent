export interface PlanningContextInput {
  projectKey?: string
  itemKey?: string
  title?: string
}

export interface PlanningContext {
  providerId: string
  projectKey?: string
  itemKey?: string
  title?: string
  url?: string
  summary?: string
  raw?: unknown
}

export interface PlanningArtifactSyncInput extends PlanningContextInput {
  body: string
}

export interface PlanningArtifactSyncResult {
  providerId?: string
  synced: boolean
  url?: string
  raw?: unknown
}

export interface PlanningProvider {
  id: string
  createPlanContext(input: PlanningContextInput): Promise<PlanningContext | null>
  syncPlanArtifact(input: PlanningArtifactSyncInput): Promise<PlanningArtifactSyncResult>
}

export interface FeishuProjectPlanningProviderConfig {
  type: 'feishu-project'
  enabled?: boolean
  base_url: string
  project_key?: string
  app_id: string
  app_secret: string
}

export interface JiraPlanningProviderConfig {
  type: 'jira'
  enabled?: boolean
  base_url: string
  project_key?: string
  auth_mode?: 'cloud' | 'basic'
  email?: string
  api_token?: string
  username?: string
  password?: string
}

export type PlanningProviderConfig =
  | FeishuProjectPlanningProviderConfig
  | JiraPlanningProviderConfig

export interface PlanningIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, PlanningProviderConfig>
}

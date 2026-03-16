export interface OperationsEvidenceRun {
  command: string
  passed: boolean
  output: string
}

export interface OperationsEvidence {
  providerId?: string
  runs: OperationsEvidenceRun[]
  summary: string
}

export interface OperationsCollectionInput {
  cwd: string
  commands: string[]
}

export interface OperationsProvider {
  id: string
  collectEvidence(input: OperationsCollectionInput): Promise<OperationsEvidence>
}

export interface LocalCommandsOperationsProviderConfig {
  type: 'local-commands'
  enabled?: boolean
  timeout_ms?: number
  max_buffer_bytes?: number
}

export type OperationsProviderConfig = LocalCommandsOperationsProviderConfig

export interface OperationsIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, OperationsProviderConfig>
}

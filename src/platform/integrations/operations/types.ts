export interface OperationsEvidenceRun {
  command: string
  passed: boolean
  output: string
}

export type ExecutionHost = 'foreground' | 'tmux'

export interface OperationsEvidence {
  providerId?: string
  runs: OperationsEvidenceRun[]
  summary: string
}

export interface OperationsCollectionInput {
  cwd: string
  commands: string[]
}

export interface OperationsLaunchInput {
  cwd: string
  command: string
  sessionName: string
}

export interface OperationsLaunchResult {
  providerId?: string
  executionHost: ExecutionHost
  sessionName: string
  windowId?: string
  paneId?: string
}

export interface OperationsProvider {
  id: string
  collectEvidence(input: OperationsCollectionInput): Promise<OperationsEvidence>
  launchCommand?(input: OperationsLaunchInput): Promise<OperationsLaunchResult>
}

export interface LocalCommandsOperationsProviderConfig {
  type: 'local-commands'
  enabled?: boolean
  timeout_ms?: number
  max_buffer_bytes?: number
}

export interface TmuxOperationsProviderConfig extends Omit<LocalCommandsOperationsProviderConfig, 'type'> {
  type: 'tmux'
  session_prefix?: string
}

export type OperationsProviderConfig =
  | LocalCommandsOperationsProviderConfig
  | TmuxOperationsProviderConfig

export interface OperationsIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, OperationsProviderConfig>
}

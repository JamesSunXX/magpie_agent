import { execFileSync } from 'child_process'
import { LocalCommandsOperationsProvider } from './local-commands.js'
import type {
  OperationsCollectionInput,
  OperationsEvidence,
  OperationsLaunchInput,
  OperationsLaunchResult,
  OperationsProvider,
  TmuxOperationsProviderConfig,
} from '../types.js'

export class TmuxOperationsProvider implements OperationsProvider {
  readonly id: string
  private readonly config: TmuxOperationsProviderConfig
  private readonly fallback: LocalCommandsOperationsProvider

  constructor(id: string, config: TmuxOperationsProviderConfig) {
    this.id = id
    this.config = config
    this.fallback = new LocalCommandsOperationsProvider(id, {
      type: 'local-commands',
      enabled: config.enabled,
      timeout_ms: config.timeout_ms,
      max_buffer_bytes: config.max_buffer_bytes,
    })
  }

  async collectEvidence(input: OperationsCollectionInput): Promise<OperationsEvidence> {
    return this.fallback.collectEvidence(input)
  }

  async launchCommand(input: OperationsLaunchInput): Promise<OperationsLaunchResult> {
    const sessionName = input.sessionName.startsWith(this.config.session_prefix || '')
      ? input.sessionName
      : `${this.config.session_prefix || 'magpie'}-${input.sessionName}`

    const raw = execFileSync('tmux', [
      'new-session',
      '-d',
      '-P',
      '-F',
      '#{session_name}\t#{window_id}\t#{pane_id}',
      '-s',
      sessionName,
      '-c',
      input.cwd,
      input.command,
    ], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()

    const [actualSessionName, windowId, paneId] = raw.split('\t')
    return {
      providerId: this.id,
      executionHost: 'tmux',
      sessionName: actualSessionName || sessionName,
      windowId,
      paneId,
    }
  }
}

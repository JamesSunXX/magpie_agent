import { OperationsRouter } from './router.js'
import { LocalCommandsOperationsProvider } from './providers/local-commands.js'
import { TmuxOperationsProvider } from './providers/tmux.js'
import type { OperationsIntegrationConfig, OperationsProvider } from './types.js'

export function createOperationsProviders(config: OperationsIntegrationConfig | undefined): Record<string, OperationsProvider> {
  const output: Record<string, OperationsProvider> = {}
  const providers = config?.providers || {}

  for (const [id, providerConfig] of Object.entries(providers)) {
    if (providerConfig.enabled === false) continue

    if (providerConfig.type === 'local-commands') {
      output[id] = new LocalCommandsOperationsProvider(id, providerConfig)
      continue
    }

    if (providerConfig.type === 'tmux') {
      output[id] = new TmuxOperationsProvider(id, providerConfig)
    }
  }

  return output
}

export function createOperationsRouter(config: OperationsIntegrationConfig | undefined): OperationsRouter {
  return new OperationsRouter({
    enabled: config?.enabled === true,
    defaultProvider: config?.default_provider,
    providers: createOperationsProviders(config),
  })
}

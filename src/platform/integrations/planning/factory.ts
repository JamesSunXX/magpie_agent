import type { PlanningIntegrationConfig, PlanningProvider } from './types.js'
import { PlanningRouter } from './router.js'
import { FeishuProjectPlanningProvider } from './providers/feishu-project.js'
import { JiraPlanningProvider } from './providers/jira.js'

export function createPlanningProviders(config: PlanningIntegrationConfig | undefined): Record<string, PlanningProvider> {
  const output: Record<string, PlanningProvider> = {}
  const providers = config?.providers || {}

  for (const [id, providerConfig] of Object.entries(providers)) {
    if (providerConfig.enabled === false) continue

    if (providerConfig.type === 'feishu-project') {
      output[id] = new FeishuProjectPlanningProvider(id, providerConfig)
      continue
    }

    if (providerConfig.type === 'jira') {
      output[id] = new JiraPlanningProvider(id, providerConfig)
    }
  }

  return output
}

export function createPlanningRouter(config: PlanningIntegrationConfig | undefined): PlanningRouter {
  return new PlanningRouter({
    enabled: config?.enabled === true,
    defaultProvider: config?.default_provider,
    providers: createPlanningProviders(config),
  })
}

import type {
  PlanningArtifactSyncInput,
  PlanningArtifactSyncResult,
  PlanningContext,
  PlanningContextInput,
  PlanningProvider,
} from './types.js'

export interface PlanningRouterOptions {
  enabled: boolean
  defaultProvider?: string
  providers: Record<string, PlanningProvider>
}

export class PlanningRouter {
  private readonly options: PlanningRouterOptions

  constructor(options: PlanningRouterOptions) {
    this.options = options
  }

  private getProvider(): PlanningProvider | null {
    if (!this.options.enabled || !this.options.defaultProvider) {
      return null
    }

    return this.options.providers[this.options.defaultProvider] || null
  }

  async createPlanContext(input: PlanningContextInput): Promise<PlanningContext | null> {
    const provider = this.getProvider()
    if (!provider) {
      return null
    }

    return provider.createPlanContext(input)
  }

  async syncPlanArtifact(input: PlanningArtifactSyncInput): Promise<PlanningArtifactSyncResult> {
    const provider = this.getProvider()
    if (!provider) {
      return { synced: false }
    }

    return provider.syncPlanArtifact(input)
  }
}

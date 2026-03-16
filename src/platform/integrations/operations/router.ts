import type { OperationsCollectionInput, OperationsEvidence, OperationsProvider } from './types.js'

export interface OperationsRouterOptions {
  enabled: boolean
  defaultProvider?: string
  providers: Record<string, OperationsProvider>
}

export class OperationsRouter {
  private readonly options: OperationsRouterOptions

  constructor(options: OperationsRouterOptions) {
    this.options = options
  }

  async collectEvidence(input: OperationsCollectionInput): Promise<OperationsEvidence> {
    if (!this.options.enabled || !this.options.defaultProvider) {
      return {
        runs: [],
        summary: 'Operations integration disabled.',
      }
    }

    const provider = this.options.providers[this.options.defaultProvider]
    if (!provider) {
      return {
        runs: [],
        summary: 'Operations provider not configured.',
      }
    }

    return provider.collectEvidence(input)
  }
}

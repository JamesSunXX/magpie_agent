import type {
  DispatchResult,
  NotificationContext,
  NotificationEvent,
  NotificationProvider,
  NotificationResult,
} from './types.js'

export interface NotificationRouterOptions {
  enabled: boolean
  defaultTimeoutMs: number
  routes: Record<string, string[]>
  providers: Record<string, NotificationProvider>
}

export class NotificationRouter {
  private readonly options: NotificationRouterOptions

  constructor(options: NotificationRouterOptions) {
    this.options = options
  }

  async dispatch(event: NotificationEvent): Promise<DispatchResult> {
    if (!this.options.enabled) {
      return {
        eventType: event.type,
        success: false,
        attempted: 0,
        delivered: 0,
        results: [],
      }
    }

    const providerIds = this.options.routes[event.type] || []
    const providers = providerIds
      .map((id) => this.options.providers[id])
      .filter((provider): provider is NotificationProvider => !!provider)

    const ctx: NotificationContext = {
      timeoutMs: this.options.defaultTimeoutMs,
    }

    const settled = await Promise.allSettled(
      providers.map(async (provider) => provider.send(event, ctx))
    )

    const results: NotificationResult[] = settled.map((item, index) => {
      if (item.status === 'fulfilled') {
        return item.value
      }
      return {
        providerId: providers[index]?.id || `unknown-${index}`,
        success: false,
        error: item.reason instanceof Error ? item.reason.message : String(item.reason),
      }
    })

    const delivered = results.filter((r) => r.success).length

    return {
      eventType: event.type,
      success: delivered > 0,
      attempted: providers.length,
      delivered,
      results,
    }
  }
}

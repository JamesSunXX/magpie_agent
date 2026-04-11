export type NotificationEventType =
  | 'stage_entered'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_paused'
  | 'stage_resumed'
  | 'human_confirmation_required'
  | 'loop_paused'
  | 'loop_resumed'
  | 'loop_failed'
  | 'loop_completed'

export type NotificationSeverity = 'info' | 'warning' | 'error'

export interface NotificationEvent {
  type: NotificationEventType
  sessionId: string
  title: string
  message: string
  severity: NotificationSeverity
  actionUrl?: string
  metadata?: Record<string, unknown>
  dedupeKey?: string
}

export interface NotificationResult {
  providerId: string
  success: boolean
  deliveredAt?: Date
  error?: string
  raw?: unknown
}

export interface DispatchResult {
  eventType: NotificationEventType
  success: boolean
  attempted: number
  delivered: number
  results: NotificationResult[]
}

export interface NotificationContext {
  timeoutMs: number
}

export interface NotificationProvider {
  id: string
  send(event: NotificationEvent, ctx: NotificationContext): Promise<NotificationResult>
}

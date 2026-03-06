import type { ImessageNotificationProviderConfig } from '../../../../../config/types.js'

export type { ImessageNotificationProviderConfig }

export interface ImessageTargetResult {
  target: string
  success: boolean
  status?: number
  error?: string
  raw?: unknown
}

export interface BlueBubblesMessageRequest {
  chatGuid: string
  text: string
  method: 'private-api' | 'apple-script'
}

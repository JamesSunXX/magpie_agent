// src/commands/review/types.ts
import type { Message } from '../../platform/providers/index.js'

export interface ReviewTarget {
  type: 'pr' | 'local' | 'branch' | 'files'
  label: string
  prompt: string  // The prompt telling AI what to review
  repo?: string   // GitHub repo (owner/name) for cross-repo PR reviews
}

export interface ReviewerSessionState {
  conversationHistory: Message[]
  sessionStarted: boolean
}

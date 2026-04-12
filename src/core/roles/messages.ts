import { randomBytes } from 'crypto'
import type { RoleMessage } from './types.js'

function createMessageId(): string {
  return `msg-${randomBytes(4).toString('hex')}`
}

export function createRoleMessage(
  input: Omit<RoleMessage, 'messageId' | 'createdAt'> & {
    messageId?: string
    createdAt?: Date
  }
): RoleMessage {
  return {
    ...input,
    messageId: input.messageId || createMessageId(),
    createdAt: input.createdAt || new Date(),
  }
}

export function isRoleMessage(value: unknown): value is RoleMessage {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<RoleMessage>
  return typeof candidate.messageId === 'string'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.roundId === 'string'
    && typeof candidate.fromRole === 'string'
    && typeof candidate.toRole === 'string'
    && typeof candidate.kind === 'string'
    && typeof candidate.summary === 'string'
    && Array.isArray(candidate.artifactRefs)
}

export function serializeRoleMessage(message: RoleMessage): string {
  return JSON.stringify({
    ...message,
    createdAt: message.createdAt.toISOString(),
  })
}

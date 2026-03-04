import { logger } from '../../shared/utils/logger.js'

export interface CapabilityContext {
  cwd: string
  sessionId: string
  logger: typeof logger
  now: Date
  configPath?: string
  metadata?: Record<string, unknown>
}

export interface CreateCapabilityContextInput {
  cwd?: string
  sessionId?: string
  configPath?: string
  metadata?: Record<string, unknown>
}

export function createCapabilityContext(input: CreateCapabilityContextInput = {}): CapabilityContext {
  return {
    cwd: input.cwd || process.cwd(),
    sessionId: input.sessionId || `cap-${Date.now().toString(36)}`,
    logger,
    now: new Date(),
    configPath: input.configPath,
    metadata: input.metadata,
  }
}

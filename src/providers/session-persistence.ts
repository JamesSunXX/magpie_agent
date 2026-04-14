import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { AIProvider, ProviderSessionRecord } from './types.js'

export const PROVIDER_SESSIONS_PATH_ENV = 'MAGPIE_PROVIDER_SESSIONS_PATH'
export const PROVIDER_SESSION_WORKFLOW_ID_ENV = 'MAGPIE_PROVIDER_SESSION_WORKFLOW_ID'
export const PROVIDER_SESSION_NAMESPACE_ENV = 'MAGPIE_PROVIDER_SESSION_NAMESPACE'

type ProviderSessionMap = Record<string, ProviderSessionRecord>

interface ProviderSessionContext {
  sessionsPath: string
  workflowSessionId: string
  namespace: string
  roleId: string
}

interface ProviderSessionPersistenceOptions {
  fallbackFactory?: () => AIProvider
}

function readProviderSessions(path: string): ProviderSessionMap {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProviderSessionMap
  } catch {
    return {}
  }
}

function writeProviderSessions(path: string, sessions: ProviderSessionMap): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(sessions, null, 2), 'utf-8')
}

function resolveRoleId(namespace: string, logicalName: string): string | null {
  if (namespace === 'loop') {
    if (logicalName === 'capabilities.loop.planner') return 'loop.planner'
    if (logicalName === 'capabilities.loop.executor') return 'loop.executor'
    return null
  }

  if (namespace === 'harness') {
    if (logicalName === 'capabilities.harness.document_planner') return 'harness.document_planner'
    const validator = logicalName.match(/^capabilities\.harness\.validator_checks\[(\d+)\]$/)
    if (validator) return `harness.validator.${validator[1]}`
    return null
  }

  if (namespace === 'harness.review') {
    if (logicalName.startsWith('reviewers.')) {
      return `harness.reviewer.${logicalName.slice('reviewers.'.length)}`
    }
    return null
  }

  if (namespace === 'harness.arbitration') {
    if (logicalName === 'summarizer') return 'harness.arbitrator'
    if (logicalName.startsWith('reviewers.')) {
      return `harness.arbitration_reviewer.${logicalName.slice('reviewers.'.length)}`
    }
    if (logicalName === 'analyzer') return 'harness.arbitration_analyzer'
    return null
  }

  return null
}

function resolveContext(logicalName: string): ProviderSessionContext | null {
  const sessionsPath = process.env[PROVIDER_SESSIONS_PATH_ENV]?.trim()
  const workflowSessionId = process.env[PROVIDER_SESSION_WORKFLOW_ID_ENV]?.trim()
  const namespace = process.env[PROVIDER_SESSION_NAMESPACE_ENV]?.trim()
  if (!sessionsPath || !workflowSessionId || !namespace) {
    return null
  }

  const roleId = resolveRoleId(namespace, logicalName)
  if (!roleId) {
    return null
  }

  return {
    sessionsPath,
    workflowSessionId,
    namespace,
    roleId,
  }
}

function persistProviderSession(
  provider: AIProvider,
  context: ProviderSessionContext,
  supportsResume: boolean
): void {
  if (!supportsResume || !provider.sessionId) {
    return
  }

  const sessions = readProviderSessions(context.sessionsPath)
  sessions[context.roleId] = {
    provider: provider.name,
    sessionId: provider.sessionId,
    workflowSessionId: context.workflowSessionId,
    roleId: context.roleId,
    updatedAt: new Date().toISOString(),
    supportsResume,
  }
  writeProviderSessions(context.sessionsPath, sessions)
}

function supportsPreciseSessionRestore(provider: AIProvider): boolean {
  return provider.supportsPreciseSessionRestore === true
    && typeof provider.restoreSession === 'function'
}

export function withProviderSessionPersistence(
  provider: AIProvider,
  logicalName: string,
  options: ProviderSessionPersistenceOptions = {}
): AIProvider {
  const context = resolveContext(logicalName)
  if (!context) {
    return provider
  }

  const record = readProviderSessions(context.sessionsPath)[context.roleId]
  const hasMatchingWorkflowRecord = Boolean(
    record
    && record.workflowSessionId === context.workflowSessionId
  )

  if (hasMatchingWorkflowRecord
    && record?.provider !== provider.name
    && typeof options.fallbackFactory === 'function') {
    provider = options.fallbackFactory()
  }

  const supportsResume = supportsPreciseSessionRestore(provider)
  if (hasMatchingWorkflowRecord
    && record?.provider === provider.name
    && record?.sessionId
    && supportsResume) {
    provider.restoreSession?.(record.sessionId, context.roleId)
  } else {
    provider.startSession?.(context.roleId)
  }

  const originalChat = provider.chat.bind(provider)
  provider.chat = async (...args) => {
    const result = await originalChat(...args)
    persistProviderSession(provider, context, supportsResume)
    return result
  }

  const originalChatStream = provider.chatStream.bind(provider)
  provider.chatStream = async function * (...args) {
    for await (const chunk of originalChatStream(...args)) {
      yield chunk
    }
    persistProviderSession(provider, context, supportsResume)
  }

  return provider
}

export async function withProviderSessionScope<T>(
  input: {
    sessionsPath: string
    workflowSessionId: string
    namespace: string
  },
  fn: () => Promise<T>
): Promise<T> {
  const previousPath = process.env[PROVIDER_SESSIONS_PATH_ENV]
  const previousWorkflow = process.env[PROVIDER_SESSION_WORKFLOW_ID_ENV]
  const previousNamespace = process.env[PROVIDER_SESSION_NAMESPACE_ENV]

  process.env[PROVIDER_SESSIONS_PATH_ENV] = input.sessionsPath
  process.env[PROVIDER_SESSION_WORKFLOW_ID_ENV] = input.workflowSessionId
  process.env[PROVIDER_SESSION_NAMESPACE_ENV] = input.namespace

  try {
    return await fn()
  } finally {
    if (previousPath === undefined) {
      delete process.env[PROVIDER_SESSIONS_PATH_ENV]
    } else {
      process.env[PROVIDER_SESSIONS_PATH_ENV] = previousPath
    }

    if (previousWorkflow === undefined) {
      delete process.env[PROVIDER_SESSION_WORKFLOW_ID_ENV]
    } else {
      process.env[PROVIDER_SESSION_WORKFLOW_ID_ENV] = previousWorkflow
    }

    if (previousNamespace === undefined) {
      delete process.env[PROVIDER_SESSION_NAMESPACE_ENV]
    } else {
      process.env[PROVIDER_SESSION_NAMESPACE_ENV] = previousNamespace
    }
  }
}

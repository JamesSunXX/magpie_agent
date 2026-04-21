import type { MagpieConfig } from '../../../../config/types.js'
import { StateManager } from '../../../../state/state-manager.js'
import { logger } from '../../../../shared/utils/logger.js'
import { getRepoMagpieDir } from '../../../paths.js'
import {
  loadThreadMappingBySession,
  loadThreadMappingByThread,
  saveThreadMapping,
  type ThreadMappingRecord,
} from '../thread-mapping.js'
import { FeishuImClient } from './client.js'
import { readFile } from 'fs/promises'
import { join } from 'path'

type TaskStatusInput = {
  capability: 'loop' | 'harness'
  sessionId: string
  status?: 'queued' | 'running' | 'paused_for_human' | 'completed' | 'failed'
  title?: string
  summary?: string
}

type HarnessSessionFile = {
  id?: string
  title?: string
  status?: string
  currentStage?: string
  summary?: string
  artifacts?: {
    lastFailurePath?: string
  }
  evidence?: {
    runtime?: {
      retryCount?: number
      nextRetryAt?: string
      lastError?: string
    }
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function inspectCommand(capability: 'loop' | 'harness', sessionId: string): string {
  return `magpie ${capability} inspect ${sessionId}`
}

function nextActionForStatus(input: {
  capability: 'loop' | 'harness'
  sessionId: string
  status: string
  nextRetryAt?: string
  reason?: string
}): string {
  if (input.nextRetryAt) {
    return `retry scheduled at ${input.nextRetryAt}`
  }
  if (input.status === 'paused_for_human' || input.status === 'blocked') {
    return `review locally with ${inspectCommand(input.capability, input.sessionId)}`
  }
  if (input.status === 'waiting_retry') {
    return 'waiting for the next retry window'
  }
  if (input.status === 'failed') {
    return `inspect the failure with ${inspectCommand(input.capability, input.sessionId)}`
  }
  if (input.status === 'completed') {
    return 'no action required'
  }
  return 'task is still running'
}

function formatStatusLines(input: {
  capability: 'loop' | 'harness'
  sessionId: string
  title?: string
  status: string
  stage?: string
  summary?: string
  reason?: string
  nextRetryAt?: string
}): string {
  const lines = [
    `${input.capability} task status`,
    `Session: ${input.sessionId}`,
    `Status: ${input.status}`,
  ]
  if (input.title) lines.push(`Title: ${input.title}`)
  if (input.stage) lines.push(`Stage: ${input.stage}`)
  if (input.summary) lines.push(`Summary: ${input.summary}`)
  if (input.reason) lines.push(`Reason: ${input.reason}`)
  lines.push(`Next: ${nextActionForStatus(input)}`)
  lines.push(`Inspect: ${inspectCommand(input.capability, input.sessionId)}`)
  return lines.join('\n')
}

async function buildHarnessStatusReply(
  cwd: string,
  input: TaskStatusInput
): Promise<string> {
  const session = await readJsonFile<HarnessSessionFile>(
    join(getRepoMagpieDir(cwd), 'sessions', 'harness', input.sessionId, 'session.json')
  )
  if (!session) {
    return formatStatusLines({
      capability: 'harness',
      sessionId: input.sessionId,
      title: input.title,
      status: input.status || 'unknown',
      summary: input.summary,
    })
  }
  const failure = session.artifacts?.lastFailurePath
    ? await readJsonFile<{ reason?: string }>(session.artifacts.lastFailurePath)
    : null

  return formatStatusLines({
    capability: 'harness',
    sessionId: input.sessionId,
    title: input.title,
    status: session.status || input.status || 'unknown',
    stage: session.currentStage,
    summary: input.summary || session.summary,
    reason: failure?.reason || session.evidence?.runtime?.lastError,
    nextRetryAt: session.evidence?.runtime?.nextRetryAt,
  })
}

async function buildLoopStatusReply(
  cwd: string,
  input: TaskStatusInput
): Promise<string> {
  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  const session = await stateManager.loadLoopSession(input.sessionId)
  if (!session) {
    return formatStatusLines({
      capability: 'loop',
      sessionId: input.sessionId,
      title: input.title,
      status: input.status || 'unknown',
      summary: input.summary,
    })
  }

  return formatStatusLines({
    capability: 'loop',
    sessionId: input.sessionId,
    title: session.goal,
    status: session.status,
    stage: session.stages[session.currentStageIndex],
    summary: input.summary,
    reason: session.lastFailureReason,
  })
}

export async function buildFeishuTaskStatusReply(
  cwd: string,
  input: TaskStatusInput
): Promise<string> {
  return input.capability === 'harness'
    ? buildHarnessStatusReply(cwd, input)
    : buildLoopStatusReply(cwd, input)
}

function getFeishuProvider(config: MagpieConfig) {
  const integration = config.integrations.im
  if (!integration?.enabled || !integration.default_provider) {
    return null
  }

  const provider = integration.providers?.[integration.default_provider]
  if (!provider || provider.type !== 'feishu-app') {
    return null
  }

  return provider
}

async function safeReplyText(client: FeishuImClient, threadKey: string, text: string): Promise<boolean> {
  try {
    await client.replyTextMessage(threadKey, text)
    return true
  } catch (error) {
    logger.warn(`Failed to publish Feishu task status: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

export async function publishFeishuTaskStatusFromConfig(
  cwd: string,
  config: MagpieConfig,
  input: TaskStatusInput & {
    status: 'queued' | 'running' | 'paused_for_human' | 'completed' | 'failed'
    title: string
    summary: string
  }
): Promise<boolean> {
  const provider = getFeishuProvider(config)
  if (!provider) {
    return false
  }

  const mapping = await loadThreadMappingBySession(cwd, input.capability, input.sessionId)
  if (!mapping) {
    return false
  }

  const client = new FeishuImClient({
    appId: provider.app_id,
    appSecret: provider.app_secret,
  })

  const reply = await buildFeishuTaskStatusReply(cwd, input)
  const sent = await safeReplyText(client, mapping.rootMessageId, reply)
  if (!sent) {
    return false
  }

  await saveThreadMapping(cwd, {
    ...mapping,
    status: input.status,
  })

  return true
}

export async function replyFeishuTaskStatusForThread(
  cwd: string,
  config: MagpieConfig,
  threadKey: string
): Promise<boolean> {
  const provider = getFeishuProvider(config)
  if (!provider) {
    return false
  }
  const mapping: ThreadMappingRecord | null = await loadThreadMappingByThread(cwd, threadKey)
  if (!mapping) {
    return false
  }

  const client = new FeishuImClient({
    appId: provider.app_id,
    appSecret: provider.app_secret,
  })

  const reply = await buildFeishuTaskStatusReply(cwd, {
    capability: mapping.capability,
    sessionId: mapping.sessionId,
    status: mapping.status as TaskStatusInput['status'],
  })

  return safeReplyText(client, mapping.rootMessageId, reply)
}

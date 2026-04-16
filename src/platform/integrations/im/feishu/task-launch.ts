import type { HarnessGraphArtifact } from '../../../../capabilities/workflows/harness-server/graph.js'
import {
  enqueueHarnessSession,
  isHarnessServerRunning,
} from '../../../../capabilities/workflows/harness-server/runtime.js'
import { canLaunchMagpieInTmux, launchMagpieInTmux } from '../../../../cli/commands/tmux-launch.js'
import { saveThreadMapping } from '../thread-mapping.js'
import { FeishuImClient } from './client.js'
import type { TaskCreationRequest } from './task-command.js'

function buildTaskRootSummary(request: TaskCreationRequest): string {
  const lines = [
    `Magpie ${request.capability} task`,
    `Goal: ${request.goal}`,
    `PRD: ${request.prdPath}`,
  ]

  if (request.priority) {
    lines.push(`Priority: ${request.priority}`)
  }

  return lines.join('\n')
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'harness-task'
}

function buildQueuedHarnessGraph(goal: string, prdPath: string): HarnessGraphArtifact {
  const now = new Date().toISOString()
  return {
    version: 1,
    graphId: slugify(goal),
    title: goal,
    goal,
    sourceRequirementPath: prdPath,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    approvalGates: [],
    rollup: {
      total: 1,
      pending: 0,
      ready: 1,
      running: 0,
      waitingRetry: 0,
      waitingApproval: 0,
      blocked: 0,
      completed: 0,
      failed: 0,
    },
    nodes: [
      {
        id: 'delivery',
        title: goal,
        goal,
        type: 'feature',
        dependencies: [],
        state: 'ready',
        riskMarkers: [],
        approvalGates: [],
      },
    ],
  }
}

export async function launchFeishuTask(cwd: string, input: {
  appId: string
  appSecret: string
  request: TaskCreationRequest
  chatId: string
  configPath?: string
}): Promise<{
  capability: 'loop' | 'harness'
  sessionId: string
  threadId: string
  status: 'queued' | 'running'
}> {
  if (input.request.capability === 'loop' && !canLaunchMagpieInTmux(input.configPath)) {
    throw new Error('tmux host requested but no enabled tmux operations provider is configured')
  }

  if (input.request.capability === 'harness'
    && !(await isHarnessServerRunning(cwd))
    && !canLaunchMagpieInTmux(input.configPath)) {
    throw new Error('tmux host requested but no enabled tmux operations provider is configured')
  }

  const client = new FeishuImClient({
    appId: input.appId,
    appSecret: input.appSecret,
  })
  const root = await client.sendRootTextMessage(input.chatId, buildTaskRootSummary(input.request))

  if (input.request.capability === 'harness') {
    if (await isHarnessServerRunning(cwd)) {
      const queued = await enqueueHarnessSession(cwd, {
        goal: input.request.goal,
        prdPath: input.request.prdPath,
        priority: input.request.priority,
      }, {
        configPath: input.configPath,
        graph: buildQueuedHarnessGraph(input.request.goal, input.request.prdPath),
      })

      await saveThreadMapping(cwd, {
        threadId: root.messageId,
        rootMessageId: root.messageId,
        chatId: input.chatId,
        capability: 'harness',
        sessionId: queued.id,
        status: 'queued',
      })

      return {
        capability: 'harness',
        sessionId: queued.id,
        threadId: root.messageId,
        status: 'queued',
      }
    }

    const launch = await launchMagpieInTmux({
      capability: 'harness',
      cwd,
      configPath: input.configPath,
      argv: [
        'harness',
        'submit',
        input.request.goal,
        '--prd',
        input.request.prdPath,
        '--host',
        'foreground',
        ...(input.configPath ? ['--config', input.configPath] : []),
        ...(input.request.priority ? ['--priority', input.request.priority] : []),
      ],
    })

    await saveThreadMapping(cwd, {
      threadId: root.messageId,
      rootMessageId: root.messageId,
      chatId: input.chatId,
      capability: 'harness',
      sessionId: launch.sessionId,
      status: 'running',
    })

    return {
      capability: 'harness',
      sessionId: launch.sessionId,
      threadId: root.messageId,
      status: 'running',
    }
  }

  const launch = await launchMagpieInTmux({
    capability: 'loop',
    cwd,
    configPath: input.configPath,
    argv: [
      'loop',
      'run',
      input.request.goal,
      '--prd',
      input.request.prdPath,
      '--host',
      'foreground',
      '--no-wait-human',
      ...(input.configPath ? ['--config', input.configPath] : []),
    ],
  })

  await saveThreadMapping(cwd, {
    threadId: root.messageId,
    rootMessageId: root.messageId,
    chatId: input.chatId,
    capability: 'loop',
    sessionId: launch.sessionId,
    status: 'running',
  })

  return {
    capability: 'loop',
    sessionId: launch.sessionId,
    threadId: root.messageId,
    status: 'running',
  }
}

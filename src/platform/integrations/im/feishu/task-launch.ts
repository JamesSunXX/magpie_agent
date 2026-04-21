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
  if (!canLaunchMagpieInTmux(input.configPath)) {
    throw new Error('tmux host requested but no enabled tmux operations provider is configured')
  }

  const client = new FeishuImClient({
    appId: input.appId,
    appSecret: input.appSecret,
  })
  const root = await client.sendRootTextMessage(input.chatId, buildTaskRootSummary(input.request))

  if (input.request.capability === 'harness') {
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

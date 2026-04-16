import { spawn } from 'child_process'
import { Command } from 'commander'
import { existsSync } from 'fs'
import { join } from 'path'
import { loadConfig } from '../../platform/config/loader.js'
import { getRepoRoot } from '../../platform/paths.js'
import { createImRuntime, loadImServerStatus, saveImServerStatus } from '../../platform/integrations/im/runtime.js'
import { createFeishuCallbackServer } from '../../platform/integrations/im/feishu/server.js'
import { handleConfirmationAction } from '../../platform/integrations/im/feishu/confirmation-bridge.js'
import { FeishuImClient } from '../../platform/integrations/im/feishu/client.js'
import { isFeishuTaskCommandText, parseFeishuTaskCommand } from '../../platform/integrations/im/feishu/task-command.js'
import { launchFeishuTask } from '../../platform/integrations/im/feishu/task-launch.js'

export function resolveFeishuProvider(configPath?: string) {
  const config = loadConfig(configPath)
  const integration = config.integrations.im
  if (!integration?.enabled || !integration.default_provider) {
    throw new Error('integrations.im is not enabled.')
  }

  const provider = integration.providers?.[integration.default_provider]
  if (!provider || provider.type !== 'feishu-app') {
    throw new Error(`IM provider not configured: ${integration.default_provider}`)
  }

  return {
    id: integration.default_provider,
    provider,
  }
}

function replySummary(result: Awaited<ReturnType<typeof handleConfirmationAction>>): string {
  if (result.status === 'applied') {
    return `Confirmation applied: ${result.decision}.`
  }

  return `Confirmation rejected: ${result.reason}`
}

function isUserActionableTaskLaunchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /tmux host requested but no enabled tmux operations provider is configured/i.test(message)
}

export async function runImServerLoop(options: { cwd: string; configPath?: string }): Promise<void> {
  const { id, provider } = resolveFeishuProvider(options.configPath)
  const runtime = createImRuntime(options.cwd)
  const client = new FeishuImClient({
    appId: provider.app_id,
    appSecret: provider.app_secret,
  })
  const path = provider.callback_path || '/callbacks/feishu'
  const port = provider.callback_port || 9321

  const server = createFeishuCallbackServer({
    path,
    verificationToken: provider.verification_token,
    onEvent: async (event) => {
      if (event.eventId && await runtime.hasProcessedEvent(event.eventId)) {
        return
      }

      if (event.kind === 'confirmation_action') {
        const result = await handleConfirmationAction(options.cwd, {
          actorOpenId: event.actorOpenId,
          whitelist: provider.approval_whitelist_open_ids,
          action: event.action,
          sessionId: event.sessionId,
          confirmationId: event.confirmationId,
          threadKey: event.threadKey,
          chatId: event.chatId,
          rejectionReason: event.rejectionReason,
          extraInstruction: event.extraInstruction,
        })

        if (event.eventId) {
          await runtime.markEventProcessed(event.eventId)
        }
        await client.replyTextMessage(event.threadKey, replySummary(result)).catch(() => {})
        return
      }

      if (!isFeishuTaskCommandText(event.text)) {
        if (event.eventId) {
          await runtime.markEventProcessed(event.eventId)
        }
        return
      }

      let request
      try {
        request = parseFeishuTaskCommand(event.text)
      } catch (error) {
        await client.replyTextMessage(event.sourceMessageId, `Task rejected: ${error instanceof Error ? error.message : String(error)}`).catch(() => {})
        if (event.eventId) {
          await runtime.markEventProcessed(event.eventId)
        }
        return
      }

      try {
        const launched = await launchFeishuTask(options.cwd, {
          appId: provider.app_id,
          appSecret: provider.app_secret,
          request,
          chatId: event.chatId,
          configPath: options.configPath,
        })

        if (event.eventId) {
          await runtime.markEventProcessed(event.eventId)
        }
        await client.replyTextMessage(launched.threadId, [
          'Task accepted.',
          `Capability: ${launched.capability}`,
          `Session: ${launched.sessionId}`,
          `Status: ${launched.status}`,
        ].join('\n')).catch(() => {})
      } catch (error) {
        if (!isUserActionableTaskLaunchError(error)) {
          throw error
        }

        await client.replyTextMessage(event.sourceMessageId, `Task rejected: ${error instanceof Error ? error.message : String(error)}`).catch(() => {})
        if (event.eventId) {
          await runtime.markEventProcessed(event.eventId)
        }
      }
    },
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, async () => {
      server.off('error', rejectPromise)
      await saveImServerStatus(options.cwd, {
        providerId: id,
        status: 'running',
        port,
        path,
        processId: process.pid,
        updatedAt: new Date().toISOString(),
      })
      console.log(`IM server listening on http://127.0.0.1:${port}${path}`)
    })

    const shutdown = async () => {
      await saveImServerStatus(options.cwd, {
        providerId: id,
        status: 'stopped',
        port,
        path,
        updatedAt: new Date().toISOString(),
      })
      server.close(() => resolvePromise())
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

export function spawnImServer(cwd: string, configPath?: string): number {
  const repoRoot = getRepoRoot(cwd)
  const cliPath = join(repoRoot, 'src', 'cli.ts')
  if (!existsSync(cliPath)) {
    throw new Error(`Cannot find source CLI entrypoint: ${cliPath}`)
  }

  const args = ['--import', 'tsx', cliPath, 'im-server', 'run']
  if (configPath) {
    args.push('--config', configPath)
  }

  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  if (!child.pid) {
    throw new Error('Failed to start IM server process.')
  }

  return child.pid
}

export const imServerCommand = new Command('im-server')
  .description('Run the inbound IM control server')

imServerCommand
  .command('start')
  .description('Start the IM callback server')
  .option('-c, --config <path>', 'Path to config file')
  .option('--foreground', 'Run the IM callback server in the current terminal')
  .action(async (options: { config?: string; foreground?: boolean }) => {
    if (options.foreground) {
      await runImServerLoop({
        cwd: process.cwd(),
        configPath: options.config,
      })
      return
    }

    const { id, provider } = resolveFeishuProvider(options.config)
    const pid = spawnImServer(process.cwd(), options.config)
    await saveImServerStatus(process.cwd(), {
      providerId: id,
      status: 'running',
      port: provider.callback_port || 9321,
      path: provider.callback_path || '/callbacks/feishu',
      processId: pid,
      updatedAt: new Date().toISOString(),
    })
    console.log(`IM server started (pid=${pid}).`)
  })

imServerCommand
  .command('status')
  .description('Show IM callback server status')
  .action(async () => {
    const status = await loadImServerStatus(process.cwd())
    if (!status) {
      console.log('IM server status: stopped')
      return
    }

    const running = status.processId
      ? (() => {
          try {
            process.kill(status.processId, 0)
            return true
          } catch {
            return false
          }
        })()
      : status.status === 'running'

    console.log(`IM server status: ${running ? 'running' : 'stopped'}`)
    console.log(`Provider: ${status.providerId}`)
    console.log(`Port: ${status.port}`)
    console.log(`Path: ${status.path}`)
    if (status.processId) {
      console.log(`PID: ${status.processId}`)
    }
  })

imServerCommand
  .command('stop')
  .description('Stop the IM callback server')
  .action(async () => {
    const status = await loadImServerStatus(process.cwd())
    if (!status?.processId) {
      console.log('IM server is not running.')
      return
    }

    try {
      process.kill(status.processId)
    } catch {
      // Treat already-dead processes as stopped.
    }

    await saveImServerStatus(process.cwd(), {
      ...status,
      status: 'stopped',
      updatedAt: new Date().toISOString(),
    })
    console.log('IM server stopped.')
  })

imServerCommand
  .command('run')
  .description('Internal foreground callback loop')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    await runImServerLoop({
      cwd: process.cwd(),
      configPath: options.config,
    })
  })

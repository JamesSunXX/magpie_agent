import { Command } from 'commander'
import {
  launchHarnessServerInTmux,
  runHarnessServerLoop,
  stopHarnessServer,
  summarizeHarnessServer,
} from '../../capabilities/workflows/harness-server/runtime.js'
import { formatLocalDateTime } from '../../platform/time.js'

export const harnessServerCommand = new Command('harness-server')
  .description('Run the persistent harness background server')

harnessServerCommand
  .command('start')
  .description('Start the harness server')
  .option('-c, --config <path>', 'Path to config file')
  .option('--foreground', 'Run the server in the current terminal')
  .action(async (options: { config?: string; foreground?: boolean }) => {
    try {
      if (options.foreground) {
        console.log('Harness server started in foreground mode.')
        await runHarnessServerLoop({
          cwd: process.cwd(),
          configPath: options.config,
        })
        return
      }

      const launch = await launchHarnessServerInTmux({
        cwd: process.cwd(),
        configPath: options.config,
      })
      console.log('Harness server started.')
      console.log('Host: tmux')
      console.log(`Tmux: ${launch.tmuxSession}`)
    } catch (error) {
      console.error(`harness-server start failed: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  })

harnessServerCommand
  .command('status')
  .description('Show harness server status')
  .action(async () => {
    const summary = await summarizeHarnessServer(process.cwd())
    if (!summary.state) {
      console.log('Status: stopped')
      console.log('Queue: queued=0 running=0 waiting_retry=0 waiting_next_cycle=0 blocked=0')
      return
    }

    console.log(`Status: ${summary.state.status}`)
    console.log(`Host: ${summary.state.executionHost}`)
    if (summary.state.tmuxSession) {
      console.log(`Tmux: ${summary.state.tmuxSession}`)
    }
    console.log(`Updated: ${formatLocalDateTime(summary.state.updatedAt)}`)
    console.log(
      `Queue: queued=${summary.queue.queued} running=${summary.queue.running} waiting_retry=${summary.queue.waitingRetry} waiting_next_cycle=${summary.queue.waitingNextCycle} blocked=${summary.queue.blocked}`
    )
    if (summary.observability.currentSession) {
      const current = summary.observability.currentSession
      console.log(
        `Current: ${current.sessionId} stage=${current.stage || '-'} status=${current.status} isolation=${current.executionIsolationMode || '-'} tools=${current.tools.join(',') || '-'}`
      )
    }
    if (summary.observability.nextRetry) {
      const retry = summary.observability.nextRetry
      console.log(
        `Next retry: ${retry.sessionId} at ${formatLocalDateTime(retry.nextRetryAt)} retry_count=${retry.retryCount} last_error=${retry.lastError || '-'}`
      )
    }
    const latestFailure = summary.observability.recentFailures[0]
    if (latestFailure) {
      console.log(`Recent failure: ${latestFailure.sessionId || '-'} stage=${latestFailure.stage || '-'} reason=${latestFailure.reason}`)
    }
    const latestEvent = summary.observability.recentEvents[0]
    if (latestEvent) {
      console.log(
        `Recent event: ${formatLocalDateTime(latestEvent.timestamp)} ${latestEvent.sessionId} ${latestEvent.type} ${latestEvent.stage || '-'} ${latestEvent.summary || ''}`.trim()
      )
    }
  })

harnessServerCommand
  .command('stop')
  .description('Stop the harness server')
  .action(async () => {
    const stopped = await stopHarnessServer(process.cwd())
    if (!stopped) {
      console.log('Harness server is not running.')
      return
    }
    console.log('Harness server stopped.')
  })

harnessServerCommand
  .command('run')
  .description('Internal foreground server loop')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    await runHarnessServerLoop({
      cwd: process.cwd(),
      configPath: options.config,
    })
  })

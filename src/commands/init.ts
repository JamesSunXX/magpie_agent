import { Command } from 'commander'
import {
  initConfigWithResult,
  AVAILABLE_REVIEWERS,
  type InitNotificationsOptions
} from '../config/init.js'
import chalk from 'chalk'
import { createInterface } from 'readline'

async function selectReviewers(): Promise<string[]> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve)
    })
  }

  console.log(chalk.cyan('\nSelect your reviewers (at least 2 recommended for debate):\n'))

  // Display options
  AVAILABLE_REVIEWERS.forEach((reviewer, index) => {
    const apiNote = reviewer.needsApiKey
      ? chalk.yellow(' [requires API key]')
      : chalk.green(' [free]')
    console.log(`  ${chalk.bold(index + 1)}. ${reviewer.name}${apiNote}`)
    console.log(`     ${chalk.dim(reviewer.description)}`)
  })

  console.log()
  const answer = await question(
    chalk.white('Enter reviewer numbers separated by comma (e.g., 1,2): ')
  )

  rl.close()

  // Parse selection
  const selections = answer
    .split(',')
    .map(s => s.trim())
    .filter(s => s)
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n >= 1 && n <= AVAILABLE_REVIEWERS.length)
    .map(n => AVAILABLE_REVIEWERS[n - 1].id)

  // Remove duplicates
  return [...new Set(selections)]
}

function parseCommaSeparated(input: string): string[] {
  return input
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
}

async function selectNotificationOptions(): Promise<InitNotificationsOptions | undefined> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve)
    })
  }

  console.log(chalk.cyan('\nNotification setup (press Enter to keep placeholder/default values):\n'))

  const feishuWebhookUrl = (await question(
    chalk.white('Feishu webhook URL [${FEISHU_WEBHOOK_URL}]: ')
  )).trim()
  const feishuWebhookSecret = (await question(
    chalk.white('Feishu webhook secret [${FEISHU_WEBHOOK_SECRET}]: ')
  )).trim()
  const imessageAppleScriptTargetsRaw = (await question(
    chalk.white('iMessage local targets (comma-separated) [handle:+8613800138000]: ')
  )).trim()
  const imessageBluebubblesServerUrl = (await question(
    chalk.white('BlueBubbles server URL [${BLUEBUBBLES_SERVER_URL}]: ')
  )).trim()
  const imessageBluebubblesPassword = (await question(
    chalk.white('BlueBubbles password [${BLUEBUBBLES_PASSWORD}]: ')
  )).trim()
  const imessageBluebubblesChatGuid = (await question(
    chalk.white('BlueBubbles chat guid [${BLUEBUBBLES_CHAT_GUID}]: ')
  )).trim()

  rl.close()

  const imessageAppleScriptTargets = imessageAppleScriptTargetsRaw
    ? parseCommaSeparated(imessageAppleScriptTargetsRaw)
    : undefined

  if (
    !feishuWebhookUrl &&
    !feishuWebhookSecret &&
    (!imessageAppleScriptTargets || imessageAppleScriptTargets.length === 0) &&
    !imessageBluebubblesServerUrl &&
    !imessageBluebubblesPassword &&
    !imessageBluebubblesChatGuid
  ) {
    return undefined
  }

  return {
    feishuWebhookUrl: feishuWebhookUrl || undefined,
    feishuWebhookSecret: feishuWebhookSecret || undefined,
    imessageAppleScriptTargets,
    imessageBluebubblesServerUrl: imessageBluebubblesServerUrl || undefined,
    imessageBluebubblesPassword: imessageBluebubblesPassword || undefined,
    imessageBluebubblesChatGuid: imessageBluebubblesChatGuid || undefined
  }
}

export const initCommand = new Command('init')
  .description('Initialize Magpie configuration')
  .option('-y, --yes', 'Use default reviewers (claude-code + codex)')
  .action(async (options) => {
    try {
      let selectedReviewers: string[] | undefined
      let notificationOptions: InitNotificationsOptions | undefined

      if (!options.yes) {
        selectedReviewers = await selectReviewers()

        if (selectedReviewers.length === 0) {
          console.log(chalk.yellow('\nNo reviewers selected. Using defaults (Claude Code + Codex CLI)'))
          selectedReviewers = ['claude-code', 'codex']
        } else if (selectedReviewers.length === 1) {
          console.log(chalk.yellow('\nOnly 1 reviewer selected. Debate works best with 2+ reviewers.'))
        }

        // Show selected reviewers
        const selected = AVAILABLE_REVIEWERS.filter(r => selectedReviewers!.includes(r.id))
        console.log(chalk.cyan('\nSelected reviewers:'))
        selected.forEach(r => {
          console.log(`  - ${r.name} (${r.model})`)
        })

        // Warn about API keys if needed
        const needsKeys = selected.filter(r => r.needsApiKey)
        if (needsKeys.length > 0) {
          console.log(chalk.yellow('\nNote: You will need to set these environment variables:'))
          const envVars = new Set<string>()
          needsKeys.forEach(r => {
            if (r.provider === 'anthropic') envVars.add('ANTHROPIC_API_KEY')
            if (r.provider === 'openai') envVars.add('OPENAI_API_KEY')
            if (r.provider === 'google') envVars.add('GOOGLE_API_KEY')
          })
          envVars.forEach(v => console.log(`  - ${v}`))
        }

        notificationOptions = await selectNotificationOptions()
      }

      const result = initConfigWithResult(
        undefined,
        selectedReviewers,
        { notifications: notificationOptions }
      )

      if (result.backupPath) {
        console.log(chalk.yellow(`\n! Existing config backed up to: ${result.backupPath}`))
      }

      console.log(chalk.green(`\n✓ Config created at: ${result.configPath}`))
      console.log(chalk.dim('Edit this file to customize your reviewers and prompts.'))
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`))
      }
      process.exit(1)
    }
  })

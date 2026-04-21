import { Command } from 'commander'
import chalk from 'chalk'
import { createInterface } from 'readline'
import {
  AVAILABLE_REVIEWERS,
  initConfigWithResult,
  upgradeConfigWithResult,
  type InitNotificationsOptions,
  type InitOperationsOptions,
  type InitPlanningOptions,
  type InitProfile,
  type ReviewerOption,
} from '../../platform/config/init.js'

type AskFn = (prompt: string) => Promise<string>
type LogFn = (message?: string) => void

async function withPromptSession<T>(run: (ask: AskFn) => Promise<T>): Promise<T> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const ask = (prompt: string): Promise<string> => new Promise(resolve => rl.question(prompt, resolve))

  try {
    return await run(ask)
  } finally {
    rl.close()
  }
}

export function parseReviewerSelection(answer: string, availableReviewers: ReviewerOption[] = AVAILABLE_REVIEWERS): string[] {
  const selections = answer
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= availableReviewers.length)
    .map(n => availableReviewers[n - 1].id)

  return [...new Set(selections)]
}

export async function promptForReviewers(
  ask: AskFn,
  availableReviewers: ReviewerOption[] = AVAILABLE_REVIEWERS,
  log: LogFn = console.log
): Promise<string[]> {
  log(chalk.cyan('\nSelect your reviewers (at least 2 recommended for debate):\n'))

  availableReviewers.forEach((reviewer, index) => {
    const apiNote = reviewer.needsApiKey ? chalk.yellow(' [requires API key]') : chalk.green(' [free]')
    log(`  ${chalk.bold(index + 1)}. ${reviewer.name}${apiNote}`)
    log(`     ${chalk.dim(reviewer.description)}`)
  })

  log()
  const answer = await ask(chalk.white('Enter reviewer numbers separated by comma (e.g., 1,2): '))
  return parseReviewerSelection(answer, availableReviewers)
}

async function selectReviewers(): Promise<string[]> {
  return withPromptSession(ask => promptForReviewers(ask))
}

function parseCommaSeparated(input: string): string[] {
  return input
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
}

function isAffirmative(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  return normalized === 'y' || normalized === 'yes'
}

export function parseInitProfileSelection(answer: string): InitProfile {
  const normalized = answer.trim().toLowerCase()
  if (normalized === '2' || normalized === 'team') return 'team'
  if (normalized === '3' || normalized === 'background') return 'background'
  return 'local'
}

export async function promptForInitProfile(
  ask: AskFn,
  log: LogFn = console.log
): Promise<InitProfile> {
  log(chalk.cyan('\nChoose setup profile:\n'))
  log('  1. Local development - simplest setup for local reviews and loop runs')
  log('  2. Team collaboration - enables skills metadata for shared workflows')
  log('  3. Background hosting - enables managed runs, skill checks, and resource guard defaults')
  const answer = await ask(chalk.white('Profile [1]: '))
  return parseInitProfileSelection(answer)
}

async function selectInitProfile(): Promise<InitProfile> {
  return withPromptSession(ask => promptForInitProfile(ask))
}

function parsePositiveInteger(input: string): number | undefined {
  const normalized = input.trim()
  if (!normalized) return undefined

  const value = Number.parseInt(normalized, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export async function promptForNotificationOptions(
  ask: AskFn,
  log: LogFn = console.log
): Promise<InitNotificationsOptions | undefined> {
  log(chalk.cyan('\nNotification setup (press Enter to keep placeholder/default values):\n'))

  const feishuWebhookUrl = (await ask(chalk.white('Feishu webhook URL [${FEISHU_WEBHOOK_URL}]: '))).trim()
  const feishuWebhookSecret = (await ask(chalk.white('Feishu webhook secret [${FEISHU_WEBHOOK_SECRET}]: '))).trim()
  const imessageAppleScriptTargetsRaw = (await ask(chalk.white('iMessage local targets (comma-separated) [handle:+8613800138000]: '))).trim()
  const imessageBluebubblesServerUrl = (await ask(chalk.white('BlueBubbles server URL [${BLUEBUBBLES_SERVER_URL}]: '))).trim()
  const imessageBluebubblesPassword = (await ask(chalk.white('BlueBubbles password [${BLUEBUBBLES_PASSWORD}]: '))).trim()
  const imessageBluebubblesChatGuid = (await ask(chalk.white('BlueBubbles chat guid [${BLUEBUBBLES_CHAT_GUID}]: '))).trim()

  const imessageAppleScriptTargets = imessageAppleScriptTargetsRaw ? parseCommaSeparated(imessageAppleScriptTargetsRaw) : undefined

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
    imessageBluebubblesChatGuid: imessageBluebubblesChatGuid || undefined,
  }
}

async function selectNotificationOptions(): Promise<InitNotificationsOptions | undefined> {
  return withPromptSession(ask => promptForNotificationOptions(ask))
}

export async function promptForPlanningOptions(
  ask: AskFn,
  log: LogFn = console.log
): Promise<InitPlanningOptions | undefined> {
  log(chalk.cyan('\nPlanning integration setup:\n'))

  const enabled = isAffirmative(await ask(chalk.white('Enable planning integration? (y/N): ')))
  if (!enabled) return undefined

  const providerAnswer = (await ask(chalk.white('Default planning provider [1=jira_main, 2=feishu_project] [1]: '))).trim()
  const defaultProvider = providerAnswer === '2' ? 'feishu_project' : 'jira_main'

  const options: InitPlanningOptions = {
    enabled: true,
    defaultProvider,
  }

  if (defaultProvider === 'jira_main') {
    const authModeAnswer = (await ask(chalk.white('Jira auth mode [1=cloud(email+api_token), 2=basic(username+password)] [1]: '))).trim()
    options.jiraAuthMode = authModeAnswer === '2' ? 'basic' : 'cloud'
    options.jiraBaseUrl = (await ask(chalk.white('Jira base URL [https://your-company.atlassian.net]: '))).trim() || undefined
    options.jiraProjectKey = (await ask(chalk.white('Jira project key [ENG]: '))).trim() || undefined
    if (options.jiraAuthMode === 'basic') {
      options.jiraUsername = (await ask(chalk.white('Jira username [${JIRA_USERNAME}]: '))).trim() || undefined
      options.jiraPassword = (await ask(chalk.white('Jira password [${JIRA_PASSWORD}]: '))).trim() || undefined
    } else {
      options.jiraEmail = (await ask(chalk.white('Jira email [${JIRA_EMAIL}]: '))).trim() || undefined
      options.jiraApiToken = (await ask(chalk.white('Jira API token [${JIRA_API_TOKEN}]: '))).trim() || undefined
    }
  } else {
    options.feishuBaseUrl = (await ask(chalk.white('Feishu project base URL [https://project.feishu.cn]: '))).trim() || undefined
    options.feishuProjectKey = (await ask(chalk.white('Feishu project key [ENG]: '))).trim() || undefined
    options.feishuAppId = (await ask(chalk.white('Feishu project app id [${FEISHU_PROJECT_APP_ID}]: '))).trim() || undefined
    options.feishuAppSecret = (await ask(chalk.white('Feishu project app secret [${FEISHU_PROJECT_APP_SECRET}]: '))).trim() || undefined
  }

  return options
}

async function selectPlanningOptions(): Promise<InitPlanningOptions | undefined> {
  return withPromptSession(ask => promptForPlanningOptions(ask))
}

export async function promptForOperationsOptions(
  ask: AskFn,
  log: LogFn = console.log
): Promise<InitOperationsOptions | undefined> {
  log(chalk.cyan('\nOperations integration setup:\n'))

  const enabled = isAffirmative(await ask(chalk.white('Enable operations integration? (y/N): ')))
  if (!enabled) return undefined

  const defaultProvider = (await ask(chalk.white('Operations provider id [local_main]: '))).trim() || undefined
  const timeoutMs = parsePositiveInteger(await ask(chalk.white('Operations timeout ms [600000]: ')))
  const maxBufferBytes = parsePositiveInteger(await ask(chalk.white('Operations max buffer bytes [10485760]: ')))

  return {
    enabled: true,
    defaultProvider,
    timeoutMs,
    maxBufferBytes,
  }
}

async function selectOperationsOptions(): Promise<InitOperationsOptions | undefined> {
  return withPromptSession(ask => promptForOperationsOptions(ask))
}

interface InitCommandOptions {
  yes?: boolean
  upgrade?: boolean
  dryRun?: boolean
  config?: string
}

interface CollectInitInputsDependencies {
  availableReviewers?: ReviewerOption[]
  selectProfile?: () => Promise<InitProfile>
  selectReviewers?: () => Promise<string[]>
  selectNotificationOptions?: () => Promise<InitNotificationsOptions | undefined>
  selectPlanningOptions?: () => Promise<InitPlanningOptions | undefined>
  selectOperationsOptions?: () => Promise<InitOperationsOptions | undefined>
  log?: LogFn
}

export interface CollectInitInputsResult {
  profile?: InitProfile
  selectedReviewers?: string[]
  notificationOptions?: InitNotificationsOptions
  planningOptions?: InitPlanningOptions
  operationsOptions?: InitOperationsOptions
}

interface InitNextStepsOptions {
  log?: LogFn
}

export function printInitNextSteps(configPath: string, options: InitNextStepsOptions = {}): void {
  const log = options.log || console.log
  log(chalk.cyan('\nNext steps:'))
  log(`  1. ${chalk.white(`magpie doctor --config ${configPath}`)}`)
  log('  2. Run your first task (for example: `magpie review --local`)')
}

export async function collectInitInputs(
  options: InitCommandOptions,
  deps: CollectInitInputsDependencies = {}
): Promise<CollectInitInputsResult> {
  const availableReviewers = deps.availableReviewers || AVAILABLE_REVIEWERS
  const chooseProfile = deps.selectProfile || selectInitProfile
  const chooseReviewers = deps.selectReviewers || selectReviewers
  const chooseNotificationOptions = deps.selectNotificationOptions || selectNotificationOptions
  const choosePlanningOptions = deps.selectPlanningOptions || selectPlanningOptions
  const chooseOperationsOptions = deps.selectOperationsOptions || selectOperationsOptions
  const log = deps.log || console.log

  let profile: InitProfile | undefined
  let selectedReviewers: string[] | undefined
  let notificationOptions: InitNotificationsOptions | undefined
  let planningOptions: InitPlanningOptions | undefined
  let operationsOptions: InitOperationsOptions | undefined

  if (!options.yes) {
    profile = await chooseProfile()
    selectedReviewers = await chooseReviewers()

    if (selectedReviewers.length === 0) {
      log(chalk.yellow('\nNo reviewers selected. Using defaults (Claude Code + Codex CLI)'))
      selectedReviewers = ['claude-code', 'codex']
    } else if (selectedReviewers.length === 1) {
      log(chalk.yellow('\nOnly 1 reviewer selected. Debate works best with 2+ reviewers.'))
    }

    const selected = availableReviewers.filter(r => selectedReviewers?.includes(r.id))
    log(chalk.cyan('\nSelected reviewers:'))
    selected.forEach(r => {
      log(`  - ${r.name} (${r.model})`)
    })

    const needsKeys = selected.filter(r => r.needsApiKey)
    if (needsKeys.length > 0) {
      log(chalk.yellow('\nNote: You will need to set these environment variables:'))
      const envVars = new Set<string>()
      needsKeys.forEach(r => {
        if (r.provider === 'anthropic') envVars.add('ANTHROPIC_API_KEY')
        if (r.provider === 'openai') envVars.add('OPENAI_API_KEY')
        if (r.provider === 'google') envVars.add('GOOGLE_API_KEY')
      })
      envVars.forEach(v => log(`  - ${v}`))
    }

    notificationOptions = await chooseNotificationOptions()
    planningOptions = await choosePlanningOptions()
    operationsOptions = await chooseOperationsOptions()
  }

  return {
    profile,
    selectedReviewers,
    notificationOptions,
    planningOptions,
    operationsOptions,
  }
}

export const initCommand = new Command('init')
  .description('Initialize Magpie configuration')
  .option('-y, --yes', 'Use default reviewers (claude-code + codex)')
  .option('--upgrade', 'Upgrade an existing config in place without regenerating custom reviewers/prompts')
  .option('--dry-run', 'Preview the generated or upgraded config without writing files')
  .option('--config <path>', 'Use a custom config path instead of ~/.magpie/config.yaml')
  .action(async (options) => {
    try {
      if (options.upgrade) {
        const result = upgradeConfigWithResult(options.config, { dryRun: options.dryRun })
        const wroteConfig = result.written !== false

        if (result.backupPath) {
          console.log(chalk.yellow(`\n! Existing config backed up to: ${result.backupPath}`))
        }

        console.log(chalk.green(`\n✓ ${wroteConfig ? 'Config upgraded at' : 'Dry run for'}: ${result.configPath}`))
        if (result.changes?.length) {
          console.log(chalk.cyan('\nChanges:'))
          result.changes.forEach(change => console.log(`  - ${change}`))
        }
        if (result.warnings?.length) {
          console.log(chalk.yellow('\nWarnings:'))
          result.warnings.forEach(warning => console.log(`  - ${warning}`))
        }
        if (!wroteConfig && result.content) {
          console.log(`\n${result.content}`)
        }
        if (wroteConfig) {
          printInitNextSteps(result.configPath)
        }
        return
      }

      const {
        profile,
        selectedReviewers,
        notificationOptions,
        planningOptions,
        operationsOptions,
      } = await collectInitInputs(options)

      const result = initConfigWithResult(undefined, selectedReviewers, {
        profile,
        notifications: notificationOptions,
        planning: planningOptions,
        operations: operationsOptions,
      }, {
        configPath: options.config,
        dryRun: options.dryRun,
      })
      const wroteConfig = result.written !== false

      if (result.backupPath) {
        console.log(chalk.yellow(`\n! Existing config backed up to: ${result.backupPath}`))
      }

      console.log(chalk.green(`\n✓ ${wroteConfig ? 'Config created at' : 'Dry run for'}: ${result.configPath}`))
      if (wroteConfig) {
        console.log(chalk.dim('Edit this file to customize your reviewers and prompts.'))
        printInitNextSteps(result.configPath)
      } else if (result.content) {
        console.log(`\n${result.content}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`))
      }
      process.exit(1)
    }
  })

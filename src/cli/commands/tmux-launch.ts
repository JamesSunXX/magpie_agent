import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { randomBytes } from 'crypto'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getMagpieHomeDir } from '../../platform/paths.js'
import { loadConfig } from '../../platform/config/loader.js'
import { createOperationsProviders } from '../../platform/integrations/operations/factory.js'
import { TmuxOperationsProvider } from '../../platform/integrations/operations/providers/tmux.js'

const SESSION_PATCH_POLL_INTERVAL_MS = 250
const SESSION_PATCH_MAX_WAIT_MS = 60_000

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildSessionId(prefix: 'loop' | 'harness'): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

function resolvePackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

function isTsxLoaderReference(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return value === 'tsx'
    || value.endsWith('/tsx')
    || value.endsWith('/tsx/dist/loader.mjs')
}

function resolveSourceLoader(packageRoot: string): string {
  for (let i = 0; i < process.execArgv.length; i++) {
    if (process.execArgv[i] === '--import' && isTsxLoaderReference(process.execArgv[i + 1])) {
      return process.execArgv[i + 1] === 'tsx'
        ? join(packageRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
        : process.execArgv[i + 1]
    }
  }

  const bundledLoader = join(packageRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
  if (existsSync(bundledLoader)) {
    return bundledLoader
  }

  return 'tsx'
}

function shouldUseSourceCli(packageRoot: string): boolean {
  const entrypoint = process.argv[1] ? resolve(process.argv[1]) : ''
  if (entrypoint === join(packageRoot, 'src', 'cli.ts')) {
    return true
  }

  return process.execArgv.some((value, index, argv) =>
    isTsxLoaderReference(value)
      || (value === '--import' && isTsxLoaderReference(argv[index + 1]))
  )
}

function buildCliCommand(cwd: string, argv: string[], env: Record<string, string>): string {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ')

  const packageRoot = resolvePackageRoot()
  const distCli = join(packageRoot, 'dist', 'cli.js')
  const srcCli = join(packageRoot, 'src', 'cli.ts')
  const args = argv.map(shellQuote).join(' ')
  if (!shouldUseSourceCli(packageRoot) && existsSync(distCli)) {
    return `${envPrefix} ${shellQuote(process.execPath)} ${shellQuote(distCli)} ${args}`.trim()
  }
  return `${envPrefix} ${shellQuote(process.execPath)} --import ${shellQuote(resolveSourceLoader(packageRoot))} ${shellQuote(srcCli)} ${args}`.trim()
}

function resolveTmuxProvider(configPath?: string): TmuxOperationsProvider {
  const config = loadConfig(configPath)
  const operationsConfig = config.integrations.operations
  const providers = createOperationsProviders(operationsConfig)
  const defaultProviderId = operationsConfig?.default_provider
  const defaultProvider = defaultProviderId ? providers[defaultProviderId] : undefined

  if (defaultProvider instanceof TmuxOperationsProvider) {
    return defaultProvider
  }

  const provider = Object.values(providers).find((item) => item instanceof TmuxOperationsProvider)
  if (provider instanceof TmuxOperationsProvider) {
    return provider
  }

  throw new Error('tmux host requested but no enabled tmux operations provider is configured')
}

async function patchSessionArtifacts(
  capability: 'loop' | 'harness',
  sessionId: string,
  patch: Record<string, string>,
): Promise<void> {
  const sessionJson = capability === 'loop'
    ? join(getMagpieHomeDir(), 'loop-sessions', `${sessionId}.json`)
    : join(getMagpieHomeDir(), 'workflow-sessions', 'harness', sessionId, 'session.json')

  const deadline = Date.now() + SESSION_PATCH_MAX_WAIT_MS
  while (Date.now() < deadline) {
    if (!existsSync(sessionJson)) {
      await new Promise((resolve) => setTimeout(resolve, SESSION_PATCH_POLL_INTERVAL_MS))
      continue
    }

    const raw = await readFile(sessionJson, 'utf-8').catch(() => '')
    if (!raw) {
      await new Promise((resolve) => setTimeout(resolve, SESSION_PATCH_POLL_INTERVAL_MS))
      continue
    }

    try {
      const parsed = JSON.parse(raw) as { artifacts?: Record<string, string> }
      parsed.artifacts = {
        ...(parsed.artifacts || {}),
        ...patch,
      }
      await writeFile(sessionJson, JSON.stringify(parsed, null, 2), 'utf-8')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SESSION_PATCH_POLL_INTERVAL_MS))
    }
  }
}

export async function launchMagpieInTmux(options: {
  capability: 'loop' | 'harness'
  cwd: string
  configPath?: string
  argv: string[]
}): Promise<{
  sessionId: string
  tmuxSession: string
  tmuxWindow?: string
  tmuxPane?: string
}> {
  const provider = resolveTmuxProvider(options.configPath)

  const sessionId = buildSessionId(options.capability)
  const sessionName = `magpie-${sessionId}`
  const command = buildCliCommand(options.cwd, options.argv, {
    MAGPIE_SESSION_ID: sessionId,
    MAGPIE_EXECUTION_HOST: 'tmux',
    MAGPIE_TMUX_SESSION: sessionName,
  })

  const launch = await provider.launchCommand({
    cwd: options.cwd,
    command,
    sessionName,
  })

  await patchSessionArtifacts(options.capability, sessionId, {
    executionHost: 'tmux',
    tmuxSession: launch.sessionName,
    ...(launch.windowId ? { tmuxWindow: launch.windowId } : {}),
    ...(launch.paneId ? { tmuxPane: launch.paneId } : {}),
  })

  return {
    sessionId,
    tmuxSession: launch.sessionName,
    tmuxWindow: launch.windowId,
    tmuxPane: launch.paneId,
  }
}

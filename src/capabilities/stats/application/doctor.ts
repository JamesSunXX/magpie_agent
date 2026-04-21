import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import type { MagpieConfigV2 } from '../../../platform/config/types.js'
import { getConfigPath, getConfigVersionStatus, loadConfig } from '../../../platform/config/loader.js'
import { getProviderForModel, getProviderForTool, type ProviderName } from '../../../providers/factory.js'

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail'

export interface DoctorCheckResult {
  id: string
  title: string
  status: DoctorCheckStatus
  message: string
  fixCommand?: string
}

export interface DoctorSummary {
  pass: number
  warn: number
  fail: number
}

export interface DoctorRunResult {
  configPath: string
  checks: DoctorCheckResult[]
  summary: DoctorSummary
}

export interface DoctorInput {
  cwd: string
  configPath?: string
}

interface DoctorDependencies {
  existsSync: (path: string) => boolean
  getConfigPath: (customPath?: string) => string
  getConfigVersionStatus: (configPath?: string) => ReturnType<typeof getConfigVersionStatus>
  loadConfig: (configPath?: string) => MagpieConfigV2
  checkCommand: (command: string) => boolean
  env: NodeJS.ProcessEnv
}

const CLI_PROVIDER_COMMAND = {
  'claude-code': 'claude',
  codex: 'codex',
  claw: 'claw',
  'gemini-cli': 'gemini',
  'qwen-code': 'qwen',
  kiro: 'kiro',
} as const

const API_PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
} as const

type CliProviderKey = keyof typeof CLI_PROVIDER_COMMAND
type ApiProviderKey = keyof typeof API_PROVIDER_ENV

function checkCommand(command: string): boolean {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Binding {
  tool?: string
  model?: string
}

function collectBindings(value: unknown, output: Binding[]): void {
  if (Array.isArray(value)) {
    value.forEach(item => collectBindings(item, output))
    return
  }

  if (!isRecord(value)) {
    return
  }

  const tool = typeof value.tool === 'string' ? value.tool.trim() : undefined
  const model = typeof value.model === 'string' ? value.model.trim() : undefined
  if (tool || model) {
    output.push({ tool, model })
  }

  Object.values(value).forEach(item => collectBindings(item, output))
}

function resolveProvider(binding: Binding): ProviderName | undefined {
  if (binding.tool) {
    return getProviderForTool(binding.tool)
  }
  if (binding.model) {
    return getProviderForModel(binding.model)
  }
  return undefined
}

interface ProviderCollectionResult {
  providers: Set<ProviderName>
  unresolvedBindings: string[]
}

function collectProviders(config: MagpieConfigV2): ProviderCollectionResult {
  const bindings: Binding[] = []
  collectBindings(config, bindings)

  const providers = new Set<ProviderName>()
  const unresolvedBindings: string[] = []

  bindings.forEach(binding => {
    try {
      const provider = resolveProvider(binding)
      if (provider) {
        providers.add(provider)
      }
    } catch (error) {
      const label = binding.tool ? `tool=${binding.tool}` : `model=${binding.model}`
      unresolvedBindings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return { providers, unresolvedBindings }
}

function summarize(checks: DoctorCheckResult[]): DoctorSummary {
  return checks.reduce<DoctorSummary>((acc, item) => {
    if (item.status === 'pass') acc.pass += 1
    if (item.status === 'warn') acc.warn += 1
    if (item.status === 'fail') acc.fail += 1
    return acc
  }, { pass: 0, warn: 0, fail: 0 })
}

export function runDoctorChecks(
  input: DoctorInput,
  deps: Partial<DoctorDependencies> = {}
): DoctorRunResult {
  const mergedDeps: DoctorDependencies = {
    existsSync: deps.existsSync || existsSync,
    getConfigPath: deps.getConfigPath || getConfigPath,
    getConfigVersionStatus: deps.getConfigVersionStatus || getConfigVersionStatus,
    loadConfig: deps.loadConfig || loadConfig,
    checkCommand: deps.checkCommand || checkCommand,
    env: deps.env || process.env,
  }

  const checks: DoctorCheckResult[] = []
  const configPath = mergedDeps.getConfigPath(input.configPath)
  const hasConfig = mergedDeps.existsSync(configPath)

  checks.push(hasConfig
    ? {
        id: 'config_file',
        title: 'Config file',
        status: 'pass',
        message: `Found config file at ${configPath}.`,
      }
    : {
        id: 'config_file',
        title: 'Config file',
        status: 'fail',
        message: `Config file not found at ${configPath}.`,
        fixCommand: `magpie init --config ${configPath}`,
      })

  const versionStatus = mergedDeps.getConfigVersionStatus(input.configPath)
  if (versionStatus.state === 'current') {
    checks.push({
      id: 'config_version',
      title: 'Config version',
      status: 'pass',
      message: 'Config version is current.',
    })
  } else if (versionStatus.state === 'outdated') {
    checks.push({
      id: 'config_version',
      title: 'Config version',
      status: 'fail',
      message: versionStatus.message || 'Config version is outdated.',
      fixCommand: `magpie init --upgrade --config ${versionStatus.path}`,
    })
  } else {
    checks.push({
      id: 'config_version',
      title: 'Config version',
      status: 'warn',
      message: versionStatus.message || 'Config version is newer than current CLI.',
    })
  }

  if (!hasConfig) {
    return {
      configPath,
      checks,
      summary: summarize(checks),
    }
  }

  let config: MagpieConfigV2
  try {
    config = mergedDeps.loadConfig(input.configPath)
    checks.push({
      id: 'config_schema',
      title: 'Config schema',
      status: 'pass',
      message: 'Config schema is valid.',
    })
  } catch (error) {
    checks.push({
      id: 'config_schema',
      title: 'Config schema',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
      fixCommand: `magpie init --upgrade --config ${configPath}`,
    })

    return {
      configPath,
      checks,
      summary: summarize(checks),
    }
  }

  const { providers, unresolvedBindings } = collectProviders(config)
  unresolvedBindings.forEach((bindingError, index) => {
    checks.push({
      id: `binding_unresolved_${index + 1}`,
      title: 'Binding parse',
      status: 'warn',
      message: `Skipped one binding during doctor checks: ${bindingError}`,
    })
  })

  // CLI provider checks ensure operators get a concrete install/login hint before runtime failure.
  const cliProviderEntries = Object.entries(CLI_PROVIDER_COMMAND) as Array<[CliProviderKey, string | undefined]>
  cliProviderEntries.forEach(([provider, command]) => {
    if (!command || !providers.has(provider)) return

    if (mergedDeps.checkCommand(command)) {
      checks.push({
        id: `cli_${provider}`,
        title: `CLI dependency (${provider})`,
        status: 'pass',
        message: `Detected "${command}" command.`,
      })
      return
    }

    checks.push({
      id: `cli_${provider}`,
      title: `CLI dependency (${provider})`,
      status: 'fail',
      message: `Missing "${command}" command in PATH.`,
      fixCommand: `Install and login ${command}, then rerun: magpie doctor --config ${configPath}`,
    })
  })

  // API provider checks only fail when the selected provider has no resolved key value at runtime.
  const apiProviderEntries = Object.entries(API_PROVIDER_ENV) as Array<[ApiProviderKey, string | undefined]>
  apiProviderEntries.forEach(([provider, envName]) => {
    if (!envName || !providers.has(provider)) return

    const configuredKey = config.providers?.[provider]?.api_key?.trim()
    const envValue = mergedDeps.env[envName]?.trim()
    const hasKey = Boolean(configuredKey) || Boolean(envValue)

    if (hasKey) {
      checks.push({
        id: `api_${provider}`,
        title: `${envName}`,
        status: 'pass',
        message: `${provider} API key is configured.`,
      })
      return
    }

    checks.push({
      id: `api_${provider}`,
      title: `${envName}`,
      status: 'fail',
      message: `Missing API key for ${provider}.`,
      fixCommand: `export ${envName}=your_api_key_here`,
    })
  })

  return {
    configPath,
    checks,
    summary: summarize(checks),
  }
}

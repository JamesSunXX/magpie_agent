import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'
import type { EnvironmentHealth, HealthSignal } from './types.js'

export interface EnvironmentHealthOptions {
  cwd: string
  configPath?: string
}

function createSignal(signal: Omit<HealthSignal, 'key'> & { key: HealthSignal['key'] }): HealthSignal {
  return signal
}

function isGitRepository(cwd: string): boolean {
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    return output === 'true'
  } catch {
    return false
  }
}

export function checkEnvironmentHealth(options: EnvironmentHealthOptions): EnvironmentHealth {
  const resolvedConfigPath = options.configPath || join(getMagpieHomeDir(), 'config.yaml')
  const workspaceDir = join(options.cwd, '.magpie')

  const items: HealthSignal[] = [
    existsSync(resolvedConfigPath)
      ? createSignal({
          key: 'config',
          label: 'Config',
          status: 'ok',
          detail: resolvedConfigPath,
        })
      : createSignal({
          key: 'config',
          label: 'Config',
          status: 'warning',
          detail: `Missing config at ${resolvedConfigPath}`,
        }),
    isGitRepository(options.cwd)
      ? createSignal({
          key: 'git',
          label: 'Git repository',
          status: 'ok',
          detail: options.cwd,
        })
      : createSignal({
          key: 'git',
          label: 'Git repository',
          status: 'warning',
          detail: 'Current directory is not a git repository',
        }),
    existsSync(workspaceDir)
      ? createSignal({
          key: 'workspace',
          label: 'Workspace state',
          status: 'ok',
          detail: workspaceDir,
        })
      : createSignal({
          key: 'workspace',
          label: 'Workspace state',
          status: 'warning',
          detail: 'No local .magpie directory yet',
        }),
    createSignal({
      key: 'providers',
      label: 'Providers',
      status: 'unknown',
      detail: 'Provider binaries and auth are not checked during startup',
    }),
  ]

  return { items }
}

export async function inspectEnvironmentHealth(options: EnvironmentHealthOptions): Promise<EnvironmentHealth> {
  return checkEnvironmentHealth(options)
}

import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

export type SessionScopedDirKind = 'workspace' | 'uploads' | 'outputs' | 'temp'

/**
 * Resolve the Magpie data directory, allowing tests and sandboxes to override it.
 */
export function getMagpieHomeDir(): string {
  return process.env.MAGPIE_HOME || join(homedir(), '.magpie')
}

function findProjectRoot(startDir: string): string {
  const resolved = existsSync(startDir) ? realpathSync(startDir) : resolve(startDir)
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: resolved,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (root) {
      return existsSync(root) ? realpathSync(root) : root
    }
  } catch {
    // Fall back to a directory walk in tests and non-git sandboxes.
  }

  let current = resolved
  let candidate = resolved
  while (true) {
    if (
      existsSync(join(current, '.git'))
      || existsSync(join(current, 'package.json'))
      || existsSync(join(current, 'AGENTS.md'))
    ) {
      candidate = current
    }
    const parent = dirname(current)
    if (parent === current) {
      return candidate
    }
    current = parent
  }
}

export function getRepoRoot(cwd: string): string {
  return findProjectRoot(cwd)
}

export function getRepoMagpieDir(cwd: string): string {
  return join(getRepoRoot(cwd), '.magpie')
}

export function getRepoSessionsDir(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'sessions')
}

export function getRepoCapabilitySessionsDir(cwd: string, capability: string): string {
  return join(getRepoSessionsDir(cwd), capability)
}

export function getRepoSessionDir(cwd: string, capability: string, sessionId: string): string {
  return join(getRepoCapabilitySessionsDir(cwd, capability), sessionId)
}

export function getRepoSessionScopedDir(
  cwd: string,
  capability: string,
  sessionId: string,
  kind: SessionScopedDirKind
): string {
  return join(getRepoSessionDir(cwd, capability, sessionId), kind)
}

export function getRepoSessionFile(cwd: string, capability: string, sessionId: string): string {
  return join(getRepoSessionDir(cwd, capability, sessionId), 'session.json')
}

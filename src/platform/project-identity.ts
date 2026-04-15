import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { getRepoRoot } from './paths.js'

export type ProjectIdentitySource = 'remote' | 'git-common-dir' | 'project-root'

export interface ProjectIdentity {
  projectRoot: string
  source: ProjectIdentitySource
  identity: string
  name: string
  storageKey: string
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readGitValue(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function normalizeRemoteUrl(remote: string): string {
  return remote
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .trim()
}

function readGitRemote(repoRoot: string): string {
  return normalizeRemoteUrl(readGitValue(repoRoot, ['remote', 'get-url', 'origin']))
}

function readGitCommonDir(repoRoot: string): string {
  const raw = readGitValue(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    || readGitValue(repoRoot, ['rev-parse', '--git-common-dir'])
  if (!raw) {
    return ''
  }

  const resolved = resolve(repoRoot, raw)
  return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function deriveNameFromCommonDir(commonDir: string, projectRoot: string): string {
  const leaf = basename(commonDir)
  if (leaf && leaf !== '.git') {
    return leaf
  }
  const parentName = basename(dirname(commonDir))
  return parentName || basename(projectRoot) || 'repo'
}

function digest(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8)
}

export function resolveProjectIdentity(repoRoot: string): ProjectIdentity {
  const projectRoot = getRepoRoot(repoRoot)
  const remote = readGitRemote(projectRoot)
  if (remote) {
    const nameSource = remote.split('/').pop() || 'repo'
    const name = normalizeKey(nameSource) || 'repo'
    return {
      projectRoot,
      source: 'remote',
      identity: remote,
      name,
      storageKey: `${name}-${digest(remote)}`,
    }
  }

  const commonDir = readGitCommonDir(projectRoot)
  if (commonDir) {
    const name = normalizeKey(deriveNameFromCommonDir(commonDir, projectRoot)) || 'repo'
    return {
      projectRoot,
      source: 'git-common-dir',
      identity: commonDir,
      name,
      storageKey: `${name}-${digest(commonDir)}`,
    }
  }

  const name = normalizeKey(basename(projectRoot) || 'repo') || 'repo'
  return {
    projectRoot,
    source: 'project-root',
    identity: projectRoot,
    name,
    storageKey: `${name}-${digest(projectRoot)}`,
  }
}

export function getProjectStorageKey(repoRoot: string): string {
  return resolveProjectIdentity(repoRoot).storageKey
}

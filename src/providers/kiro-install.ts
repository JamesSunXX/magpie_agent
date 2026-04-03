import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

const MANAGED_DIRS = ['agents', 'prompts', 'skills', 'hooks'] as const
const AGENT_DIR_CANDIDATES = ['agents', 'agent'] as const
const AGENT_FILE_EXTENSIONS = ['json', 'md'] as const

export interface EnsureKiroInstallInput {
  sourceDir: string
  desiredAgent?: string
}

export interface EnsureKiroInstallResult {
  selectedAgent: string
  installed: boolean
}

export function getKiroHome(): string {
  return process.env.KIRO_HOME || join(homedir(), '.kiro')
}

export function getKiroInstallMetadataPath(kiroHome = getKiroHome()): string {
  return join(kiroHome, '.magpie', 'kiro-install.json')
}

export function hasKiroAgent(rootDir: string, agentName: string): boolean {
  return AGENT_DIR_CANDIDATES.some((dir) => (
    AGENT_FILE_EXTENSIONS.some((ext) => existsSync(join(rootDir, dir, `${agentName}.${ext}`)))
  ))
}

export interface ResolveInstalledKiroAgentInput {
  desiredAgent?: string
  cwd?: string
  kiroHome?: string
}

export function resolveInstalledKiroAgent(input: ResolveInstalledKiroAgentInput): string {
  if (!input.desiredAgent) {
    return 'kiro_default'
  }

  const searchRoots = [
    input.cwd ? join(resolve(input.cwd), '.kiro') : null,
    input.kiroHome || getKiroHome(),
  ].filter((root): root is string => Boolean(root))

  return searchRoots.some((root) => hasKiroAgent(root, input.desiredAgent!))
    ? input.desiredAgent
    : 'kiro_default'
}

export function readExpectedKiroSourceVersion(sourceDir: string): string {
  const resolvedSource = resolve(sourceDir)
  const script = [
    'set -euo pipefail',
    `if git -C ${JSON.stringify(resolvedSource)} rev-parse HEAD >/dev/null 2>&1; then`,
    `  git -C ${JSON.stringify(resolvedSource)} rev-parse HEAD`,
    'else',
    `  find ${JSON.stringify(join(resolvedSource, 'agents'))} ${JSON.stringify(join(resolvedSource, 'prompts'))} ${JSON.stringify(join(resolvedSource, 'skills'))} ${JSON.stringify(join(resolvedSource, 'hooks'))} -type f | sort | xargs shasum -a 256 | shasum -a 256 | awk '{print $1}'`,
    'fi',
  ].join('\n')

  return execFileSync('bash', ['-lc', script], { encoding: 'utf-8' }).trim()
}

function readInstalledMetadata(metadataPath: string): { sourceVersion?: string } | null {
  if (!existsSync(metadataPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(metadataPath, 'utf-8')) as { sourceVersion?: string }
  } catch {
    return null
  }
}

export function ensureKiroInstall(input: EnsureKiroInstallInput): EnsureKiroInstallResult {
  const sourceDir = resolve(input.sourceDir)
  const kiroHome = getKiroHome()
  const metadataPath = getKiroInstallMetadataPath(kiroHome)

  const missingManagedDir = MANAGED_DIRS.some((dir) => !existsSync(join(kiroHome, dir)))
  const expectedVersion = readExpectedKiroSourceVersion(sourceDir)
  const metadata = readInstalledMetadata(metadataPath)

  const needsInstall = (
    missingManagedDir
    || !metadata
    || metadata.sourceVersion !== expectedVersion
    || (typeof input.desiredAgent === 'string' && !hasKiroAgent(kiroHome, input.desiredAgent))
  )

  if (needsInstall) {
    execFileSync('bash', [join(sourceDir, 'install.sh')], {
      cwd: sourceDir,
      stdio: 'pipe',
      env: process.env,
    })
  }

  const selectedAgent = resolveInstalledKiroAgent({
    desiredAgent: input.desiredAgent,
    kiroHome,
  })

  return {
    selectedAgent,
    installed: needsInstall,
  }
}

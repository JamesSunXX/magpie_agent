import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

const MANAGED_DIRS = ['agents', 'prompts', 'skills', 'hooks'] as const

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
  const requestedAgentPath = input.desiredAgent
    ? join(kiroHome, 'agents', `${input.desiredAgent}.json`)
    : null

  const missingManagedDir = MANAGED_DIRS.some((dir) => !existsSync(join(kiroHome, dir)))
  const expectedVersion = readExpectedKiroSourceVersion(sourceDir)
  const metadata = readInstalledMetadata(metadataPath)

  const needsInstall = (
    missingManagedDir
    || !metadata
    || metadata.sourceVersion !== expectedVersion
    || (requestedAgentPath !== null && !existsSync(requestedAgentPath))
  )

  if (needsInstall) {
    execFileSync('bash', [join(sourceDir, 'install.sh')], {
      cwd: sourceDir,
      stdio: 'pipe',
      env: process.env,
    })
  }

  const selectedAgent = input.desiredAgent
    && existsSync(join(kiroHome, 'agents', `${input.desiredAgent}.json`))
    ? input.desiredAgent
    : 'kiro_default'

  return {
    selectedAgent,
    installed: needsInstall,
  }
}

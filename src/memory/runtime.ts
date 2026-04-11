import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'

export interface MemoryPaths {
  userPath: string
  projectPath: string
}

const USER_MEMORY_TEMPLATE = '# User Memory\n\n- Record stable personal preferences here.\n'
const PROJECT_MEMORY_TEMPLATE = '# Project Memory\n\n- Record stable repository rules and learned practices here.\n'

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readGitRemote(repoRoot: string): string {
  try {
    return execSync('git remote get-url origin', {
      cwd: resolve(repoRoot),
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
    // Fallback to directory walk for non-git tests and sandboxes.
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

export function projectMemoryKey(repoRoot: string): string {
  const resolved = findProjectRoot(repoRoot)
  const remote = normalizeRemoteUrl(readGitRemote(resolved))
  const identity = remote || resolved
  const nameSource = remote ? remote.split('/').pop() || 'repo' : basename(resolved)
  const name = normalizeKey(nameSource) || 'repo'
  const digest = createHash('sha1').update(identity).digest('hex').slice(0, 8)
  return `${name}-${digest}`
}

function readOptionalSync(path: string): string {
  if (!existsSync(path)) {
    return ''
  }
  return readFileSync(path, 'utf-8').trim()
}

async function ensureFile(path: string, template: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (!existsSync(path)) {
    await writeFile(path, template, 'utf-8')
  }
}

async function readOptional(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf-8')).trim()
  } catch {
    return ''
  }
}

function renderSection(title: string, content: string): string {
  if (!content) return ''
  return `${title}:\n${content}`
}

function readRepositoryKnowledgeSummarySync(repoRoot: string): string {
  const repoDir = join(getMagpieHomeDir(), 'knowledge', projectMemoryKey(repoRoot))
  const sections: string[] = []

  const index = readOptionalSync(join(repoDir, 'index.md'))
  if (index) {
    sections.push(index)
  }

  return sections.join('\n\n').trim()
}

export function getUserMemoryPath(): string {
  return join(getMagpieHomeDir(), 'memories', 'USER.md')
}

export function getProjectMemoryPath(repoRoot: string): string {
  return join(getMagpieHomeDir(), 'memories', 'projects', projectMemoryKey(repoRoot), 'PROJECT.md')
}

export async function ensureMemoryFiles(repoRoot: string): Promise<MemoryPaths> {
  const paths = {
    userPath: getUserMemoryPath(),
    projectPath: getProjectMemoryPath(repoRoot),
  }

  await ensureFile(paths.userPath, USER_MEMORY_TEMPLATE)
  await ensureFile(paths.projectPath, PROJECT_MEMORY_TEMPLATE)

  return paths
}

export function readUserMemorySync(): string {
  return readOptionalSync(getUserMemoryPath())
}

export function readProjectMemorySync(repoRoot: string): string {
  return readOptionalSync(getProjectMemoryPath(repoRoot))
}

export function loadPersistentMemoryContextSync(repoRoot: string): string {
  const sections = [
    renderSection('User memory', readUserMemorySync()),
    renderSection('Project memory', readProjectMemorySync(repoRoot)),
    renderSection('Repository knowledge', readRepositoryKnowledgeSummarySync(repoRoot)),
  ].filter(Boolean)

  return sections.join('\n\n---\n\n')
}

export async function loadPersistentMemoryContext(repoRoot: string): Promise<string> {
  const projectPath = getProjectMemoryPath(repoRoot)
  const userContent = await readOptional(getUserMemoryPath())
  const projectContent = await readOptional(projectPath)
  const sections = [
    renderSection('User memory', userContent),
    renderSection('Project memory', projectContent),
    renderSection('Repository knowledge', readRepositoryKnowledgeSummarySync(repoRoot)),
  ].filter(Boolean)

  return sections.join('\n\n---\n\n')
}

function upsertPromotedSection(content: string, linesToAppend: string[]): string {
  const header = '## Promoted Knowledge'
  const trimmed = content.trimEnd()
  const existingIndex = trimmed.indexOf(header)
  const existingLines = existingIndex >= 0
    ? trimmed.slice(existingIndex + header.length).split('\n').map((line) => line.trim()).filter(Boolean)
    : []
  const mergedLines = [...existingLines]

  for (const line of linesToAppend) {
    if (!mergedLines.includes(line)) {
      mergedLines.push(line)
    }
  }

  if (existingIndex >= 0) {
    const prefix = trimmed.slice(0, existingIndex).trimEnd()
    return `${prefix}\n\n${header}\n\n${mergedLines.join('\n')}\n`
  }

  return `${trimmed}\n\n${header}\n\n${mergedLines.join('\n')}\n`
}

export async function syncProjectMemoryFromPromotedKnowledge(
  repoRoot: string,
  promoted: Array<{ title: string; type: string; summary: string }>
): Promise<string> {
  const { projectPath } = await ensureMemoryFiles(repoRoot)
  if (promoted.length === 0) {
    return projectPath
  }

  const current = await readOptional(projectPath)
  const next = upsertPromotedSection(
    current || PROJECT_MEMORY_TEMPLATE.trim(),
    promoted.map((item) => `- [${item.type}] ${item.title}: ${item.summary}`)
  )
  await writeFile(projectPath, `${next.trimEnd()}\n`, 'utf-8')
  return projectPath
}

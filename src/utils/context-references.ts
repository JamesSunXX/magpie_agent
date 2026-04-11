import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { relative, resolve, join } from 'path'
import { loadPersistentMemoryContext, readProjectMemorySync, readUserMemorySync } from '../memory/runtime.js'

const REFERENCE_PATTERN = /@(?:file|dir|url):\S+|@diff(?::\S+)?|@project-memory|@user-memory/g
const TRAILING_PUNCTUATION_CHARS = new Set([')', ',', '.', ';', '!', '?'])

interface ResolveContextReferencesOptions {
  cwd: string
  maxTotalChars?: number
}

function ensureRepoLocalPath(cwd: string, candidate: string): string {
  const resolved = resolve(cwd, candidate)
  const relativePath = relative(cwd, resolved)
  if (relativePath.startsWith('..') || relativePath === '') {
    if (relativePath === '') return resolved
    throw new Error(`Context reference must stay within the current repository: ${candidate}`)
  }
  return resolved
}

async function readTextFile(path: string): Promise<string> {
  const content = await readFile(path, 'utf-8')
  if (content.includes('\u0000')) {
    throw new Error(`Binary files are not supported in context references: ${path}`)
  }
  return content.trim()
}

async function expandFileReference(cwd: string, rawPath: string): Promise<string> {
  const filePath = ensureRepoLocalPath(cwd, rawPath)
  if (!existsSync(filePath)) {
    throw new Error(`Context file not found: ${rawPath}`)
  }
  const content = await readTextFile(filePath)
  return `[file] ${relative(cwd, filePath) || rawPath}\n${content}`
}

async function collectDirectoryEntries(root: string, dir: string, entries: string[], maxFiles: number): Promise<void> {
  if (entries.length >= maxFiles) return
  const dirents = await readdir(dir, { withFileTypes: true })
  for (const entry of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectDirectoryEntries(root, fullPath, entries, maxFiles)
      if (entries.length >= maxFiles) return
      continue
    }
    entries.push(relative(root, fullPath))
    if (entries.length >= maxFiles) return
  }
}

async function expandDirectoryReference(cwd: string, rawPath: string): Promise<string> {
  const dirPath = ensureRepoLocalPath(cwd, rawPath)
  if (!existsSync(dirPath)) {
    throw new Error(`Context directory not found: ${rawPath}`)
  }

  const files: string[] = []
  await collectDirectoryEntries(cwd, dirPath, files, 10)
  const sections = [`[directory] ${relative(cwd, dirPath) || rawPath}`, ...files.map((file) => `- ${file}`)]

  for (const file of files.slice(0, 3)) {
    const content = await readTextFile(join(cwd, file))
    sections.push('', `[file] ${file}`, content.slice(0, 2000))
  }

  return sections.join('\n')
}

function expandDiffReference(cwd: string, ref: string): string {
  const range = ref ? `${ref}...HEAD` : 'HEAD'
  const args = ref ? ['diff', `${ref}...HEAD`] : ['diff', 'HEAD']
  const diff = execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
  }).trim()
  return `[diff] ${range}\n${diff || '(no changes)'}`.trim()
}

async function expandUrlReference(rawUrl: string): Promise<string> {
  if (!/^https?:\/\//.test(rawUrl)) {
    throw new Error(`Only http/https URLs are supported: ${rawUrl}`)
  }
  const response = await fetch(rawUrl)
  if (!response.ok) {
    throw new Error(`Failed to load URL context: ${rawUrl} (${response.status})`)
  }
  const text = (await response.text()).trim()
  return `[url] ${rawUrl}\n${text.slice(0, 4000)}`
}

async function expandReference(token: string, cwd: string): Promise<string> {
  if (token === '@user-memory') {
    return `[user-memory]\n${readUserMemorySync()}`
  }
  if (token === '@project-memory') {
    return `[project-memory]\n${readProjectMemorySync(cwd) || await loadPersistentMemoryContext(cwd)}`
  }
  if (token.startsWith('@file:')) {
    return expandFileReference(cwd, token.slice('@file:'.length))
  }
  if (token.startsWith('@dir:')) {
    return expandDirectoryReference(cwd, token.slice('@dir:'.length))
  }
  if (token.startsWith('@url:')) {
    return expandUrlReference(token.slice('@url:'.length))
  }
  if (token === '@diff') {
    return expandDiffReference(cwd, '')
  }
  if (token.startsWith('@diff:')) {
    return expandDiffReference(cwd, token.slice('@diff:'.length))
  }
  return token
}

function splitTrailingPunctuation(token: string): { referenceToken: string; trailing: string } {
  let end = token.length
  let trailing = ''

  while (end > 0) {
    const ch = token[end - 1]
    if (!TRAILING_PUNCTUATION_CHARS.has(ch)) {
      break
    }

    if (ch === ')') {
      const candidate = token.slice(0, end)
      const opening = candidate.split('(').length - 1
      const closing = candidate.split(')').length - 1
      if (closing <= opening) {
        break
      }
    }

    trailing = `${ch}${trailing}`
    end -= 1
  }

  return {
    referenceToken: token.slice(0, end),
    trailing,
  }
}

export async function resolveContextReferences(
  input: string,
  options: ResolveContextReferencesOptions
): Promise<string> {
  if (!input || !input.includes('@')) {
    return input
  }

  const matches = [...input.matchAll(REFERENCE_PATTERN)]
  if (matches.length === 0) {
    return input
  }

  let result = ''
  let lastIndex = 0
  let consumedChars = 0
  const maxTotalChars = options.maxTotalChars ?? 20_000

  for (const match of matches) {
    const token = match[0]
    const index = match.index ?? 0
    result += input.slice(lastIndex, index)
    const { referenceToken, trailing } = splitTrailingPunctuation(token)
    const expanded = await expandReference(referenceToken, options.cwd)
    const remaining = maxTotalChars - consumedChars
    const limited = remaining > 0 ? expanded.slice(0, remaining) : '[context truncated]'
    result += limited
    result += trailing
    consumedChars += limited.length
    lastIndex = index + token.length
  }

  result += input.slice(lastIndex)
  return result
}

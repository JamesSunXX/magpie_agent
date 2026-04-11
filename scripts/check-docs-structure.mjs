#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const root = process.cwd()

export const ROOT_README_PATH = 'README.md'
export const AGENTS_PATH = 'AGENTS.md'
export const ARCHITECTURE_PATH = 'ARCHITECTURE.md'
export const DOCS_INDEX_PATH = 'docs/README.md'
export const CAPABILITY_REFERENCE_PATH = 'docs/references/capabilities.md'

export const REQUIRED_DOCS = [
  ROOT_README_PATH,
  AGENTS_PATH,
  ARCHITECTURE_PATH,
  DOCS_INDEX_PATH,
  CAPABILITY_REFERENCE_PATH,
]

export const REQUIRED_LINKS = new Map([
  [ROOT_README_PATH, [DOCS_INDEX_PATH, ARCHITECTURE_PATH]],
  [AGENTS_PATH, [DOCS_INDEX_PATH]],
  [DOCS_INDEX_PATH, [ARCHITECTURE_PATH, CAPABILITY_REFERENCE_PATH]],
])

function toPosix(value) {
  return value.replace(/\\/g, '/')
}

function normalizedRelativePath(fromPath, toPath) {
  const relative = toPosix(path.relative(path.posix.dirname(fromPath), toPath))
  return relative === '' ? path.posix.basename(toPath) : relative
}

function expectedLinkTargets(fromPath, toPath) {
  const relative = normalizedRelativePath(fromPath, toPath)
  return new Set([relative, `./${relative}`])
}

function hasRequiredLink(content, fromPath, toPath) {
  const options = expectedLinkTargets(fromPath, toPath)
  return [...options].some((candidate) => content.includes(`(${candidate})`))
}

export function findMissingDocs(existingPaths) {
  const existing = new Set(existingPaths)
  return REQUIRED_DOCS.filter((docPath) => !existing.has(docPath))
}

export function findMissingLinks(files) {
  const errors = []

  for (const [fromPath, requiredTargets] of REQUIRED_LINKS.entries()) {
    const content = files.get(fromPath)
    if (!content) continue

    for (const targetPath of requiredTargets) {
      if (!hasRequiredLink(content, fromPath, targetPath)) {
        errors.push(`${fromPath} must link to ${targetPath}`)
      }
    }
  }

  return errors
}

export function validateDocumentationStructure(files) {
  const missingDocs = findMissingDocs([...files.keys()])
  const errors = [
    ...missingDocs.map((docPath) => `Missing required document: ${docPath}`),
    ...findMissingLinks(files),
  ]

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function readFiles(paths, baseDir = root) {
  const files = new Map()
  for (const docPath of paths) {
    const absolutePath = path.join(baseDir, docPath)
    if (!fs.existsSync(absolutePath)) continue
    files.set(docPath, fs.readFileSync(absolutePath, 'utf-8'))
  }
  return files
}

export function runDocumentationCheck({
  baseDir = root,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const files = readFiles(REQUIRED_DOCS, baseDir)
  const result = validateDocumentationStructure(files)

  if (result.valid) {
    stdout('Documentation structure check passed.')
    return result
  }

  stderr('Documentation structure check failed:')
  for (const error of result.errors) {
    stderr(`- ${error}`)
  }
  return result
}

function main() {
  const result = runDocumentationCheck()
  if (result.valid) {
    return
  }
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

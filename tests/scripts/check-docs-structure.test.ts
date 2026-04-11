import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  AGENTS_PATH,
  ARCHITECTURE_PATH,
  DOCS_INDEX_PATH,
  ROOT_README_PATH,
  CAPABILITY_REFERENCE_PATH,
  REQUIRED_DOCS,
  findMissingDocs,
  findMissingLinks,
  readFiles,
  runDocumentationCheck,
  validateDocumentationStructure,
} from '../../scripts/check-docs-structure.mjs'

describe('check-docs-structure', () => {
  it('returns missing required docs', () => {
    expect(findMissingDocs([ROOT_README_PATH, AGENTS_PATH])).toEqual([
      ARCHITECTURE_PATH,
      DOCS_INDEX_PATH,
      CAPABILITY_REFERENCE_PATH,
    ])
  })

  it('returns missing required links', () => {
    const files = new Map([
      [ROOT_README_PATH, '# Magpie'],
      [AGENTS_PATH, '# Repository Guidelines'],
      [DOCS_INDEX_PATH, '# Docs'],
      [ARCHITECTURE_PATH, '# Architecture'],
      [CAPABILITY_REFERENCE_PATH, '# Capability Reference'],
    ])

    expect(findMissingLinks(files)).toEqual([
      `${ROOT_README_PATH} must link to ${DOCS_INDEX_PATH}`,
      `${ROOT_README_PATH} must link to ${ARCHITECTURE_PATH}`,
      `${AGENTS_PATH} must link to ${DOCS_INDEX_PATH}`,
      `${DOCS_INDEX_PATH} must link to ${ARCHITECTURE_PATH}`,
      `${DOCS_INDEX_PATH} must link to ${CAPABILITY_REFERENCE_PATH}`,
    ])
  })

  it('passes when required docs and links are present', () => {
    const files = new Map([
      [
        ROOT_README_PATH,
        `# Magpie

See [Docs](./${DOCS_INDEX_PATH}) and [Architecture](./${ARCHITECTURE_PATH}).`,
      ],
      [
        AGENTS_PATH,
        `# Repository Guidelines

Start with [Docs](./${DOCS_INDEX_PATH}).`,
      ],
      [
        DOCS_INDEX_PATH,
        `# Docs

See [Architecture](../${ARCHITECTURE_PATH}) and [Capability Reference](./references/capabilities.md).`,
      ],
      [ARCHITECTURE_PATH, '# Architecture'],
      [CAPABILITY_REFERENCE_PATH, '# Capability Reference'],
    ])

    expect(validateDocumentationStructure(files)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('reads only existing required docs from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-docs-check-'))
    mkdirSync(join(dir, 'docs', 'references'), { recursive: true })
    writeFileSync(join(dir, ROOT_README_PATH), '# Magpie')
    writeFileSync(join(dir, 'docs', 'references', 'capabilities.md'), '# Capability Reference')

    const files = readFiles(REQUIRED_DOCS, dir)

    expect([...files.keys()]).toEqual([
      ROOT_README_PATH,
      CAPABILITY_REFERENCE_PATH,
    ])
  })

  it('reports failures through the runner helper', () => {
    const stdout = []
    const stderr = []
    const dir = mkdtempSync(join(tmpdir(), 'magpie-docs-check-'))
    mkdirSync(join(dir, 'docs', 'references'), { recursive: true })
    writeFileSync(join(dir, ROOT_README_PATH), '# Magpie')

    const result = runDocumentationCheck({
      baseDir: dir,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    })

    expect(result.valid).toBe(false)
    expect(stdout).toEqual([])
    expect(stderr[0]).toBe('Documentation structure check failed:')
    expect(stderr).toContain(`- Missing required document: ${AGENTS_PATH}`)
  })

  it('prints a pass message through the runner helper', () => {
    const stdout = []
    const stderr = []
    const dir = mkdtempSync(join(tmpdir(), 'magpie-docs-check-'))
    mkdirSync(join(dir, 'docs', 'references'), { recursive: true })
    writeFileSync(join(dir, ROOT_README_PATH), `# Magpie

See [Docs](./${DOCS_INDEX_PATH}) and [Architecture](./${ARCHITECTURE_PATH}).`)
    writeFileSync(join(dir, AGENTS_PATH), `# Repository Guidelines

Start with [Docs](./${DOCS_INDEX_PATH}).`)
    writeFileSync(join(dir, ARCHITECTURE_PATH), '# Architecture')
    writeFileSync(join(dir, DOCS_INDEX_PATH), `# Docs

See [Architecture](../${ARCHITECTURE_PATH}) and [Capability Reference](./references/capabilities.md).`)
    writeFileSync(join(dir, CAPABILITY_REFERENCE_PATH), '# Capability Reference')

    const result = runDocumentationCheck({
      baseDir: dir,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    })

    expect(result).toEqual({
      valid: true,
      errors: [],
    })
    expect(stdout).toEqual(['Documentation structure check passed.'])
    expect(stderr).toEqual([])
  })
})

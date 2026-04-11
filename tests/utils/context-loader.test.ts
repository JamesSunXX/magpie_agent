import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { getProjectMemoryPath } from '../../src/memory/runtime.js'
import { loadProjectContext } from '../../src/utils/context-loader.js'

describe('loadProjectContext', () => {
  let magpieHome: string | undefined
  let repoRoot: string | undefined

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true })
      repoRoot = undefined
    }
  })

  it('includes AGENTS context plus persistent user and project memory', () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-context-home-'))
    process.env.MAGPIE_HOME = magpieHome
    repoRoot = mkdtempSync(join(tmpdir(), 'magpie-context-repo-'))
    mkdirSync(join(repoRoot, 'nested'), { recursive: true })

    writeFileSync(join(repoRoot, 'AGENTS.md'), 'Project instructions live here.', 'utf-8')
    mkdirSync(join(magpieHome, 'memories'), { recursive: true })
    writeFileSync(join(magpieHome, 'memories', 'USER.md'), '# User Memory\n\n- Reply in Chinese.\n', 'utf-8')

    const projectPath = getProjectMemoryPath(repoRoot)
    mkdirSync(join(projectPath, '..'), { recursive: true })
    writeFileSync(projectPath, '# Project Memory\n\n- Keep CLI help updated.\n', 'utf-8')

    const context = loadProjectContext('codex', join(repoRoot, 'nested'))

    expect(context).toContain('Project instructions live here.')
    expect(context).toContain('Reply in Chinese.')
    expect(context).toContain('Keep CLI help updated.')
  })
})

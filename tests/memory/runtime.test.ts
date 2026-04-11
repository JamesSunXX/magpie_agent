import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureMemoryFiles,
  getProjectMemoryPath,
  getUserMemoryPath,
  loadPersistentMemoryContext,
  syncProjectMemoryFromPromotedKnowledge,
} from '../../src/memory/runtime.js'
import type { KnowledgeCandidate } from '../../src/knowledge/runtime.js'

describe('memory runtime', () => {
  let magpieHome: string | undefined

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('creates user and project memory files and renders them into prompt context', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-home-'))
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = mkdtempSync(join(tmpdir(), 'magpie-memory-repo-'))
    const ensured = await ensureMemoryFiles(repoRoot)

    writeFileSync(ensured.userPath, '# User Memory\n\n- Prefer concise Chinese summaries.\n', 'utf-8')
    writeFileSync(ensured.projectPath, '# Project Memory\n\n- Always run build before final reply.\n', 'utf-8')

    const context = await loadPersistentMemoryContext(repoRoot)

    expect(ensured.userPath).toBe(getUserMemoryPath())
    expect(ensured.projectPath).toBe(getProjectMemoryPath(repoRoot))
    expect(readFileSync(ensured.userPath, 'utf-8')).toContain('# User Memory')
    expect(readFileSync(ensured.projectPath, 'utf-8')).toContain('# Project Memory')
    expect(context).toContain('User memory')
    expect(context).toContain('Prefer concise Chinese summaries.')
    expect(context).toContain('Project memory')
    expect(context).toContain('Always run build before final reply.')
  })

  it('appends promoted knowledge summaries into the project memory file without duplicating titles', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-'))
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = mkdtempSync(join(tmpdir(), 'magpie-memory-repo-'))
    await ensureMemoryFiles(repoRoot)

    const promoted: KnowledgeCandidate[] = [
      {
        type: 'decision',
        title: 'Prefer staged rollout',
        summary: 'Roll out to canary before full release.',
        sourceSessionId: 'loop-123',
        status: 'promoted',
      },
    ]

    await syncProjectMemoryFromPromotedKnowledge(repoRoot, promoted)
    await syncProjectMemoryFromPromotedKnowledge(repoRoot, promoted)

    const content = readFileSync(getProjectMemoryPath(repoRoot), 'utf-8')
    expect(content).toContain('## Promoted Knowledge')
    expect(content).toContain('Prefer staged rollout')
    expect(content.match(/Prefer staged rollout/g)).toHaveLength(1)
  })
})

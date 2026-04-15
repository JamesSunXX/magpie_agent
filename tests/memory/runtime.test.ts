import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureMemoryFiles,
  getProjectMemoryPath,
  projectMemoryKey,
  getUserMemoryPath,
  loadPersistentMemoryContext,
  syncProjectMemoryFromPromotedKnowledge,
} from '../../src/memory/runtime.js'
import type { KnowledgeCandidate } from '../../src/knowledge/runtime.js'

describe('memory runtime', () => {
  let magpieHome: string | undefined
  const tempDirs: string[] = []

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('creates user and project memory files and renders them into prompt context', async () => {
    magpieHome = tempDir('magpie-memory-home-')
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = tempDir('magpie-memory-repo-')
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
    magpieHome = tempDir('magpie-memory-promote-')
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = tempDir('magpie-memory-repo-')
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

  it('uses the same project key for a main repo and its worktree when no remote exists', () => {
    const repoRoot = tempDir('magpie-memory-main-repo-')
    const worktreeRoot = tempDir('magpie-memory-worktree-')

    execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot, stdio: 'pipe' })
    writeFileSync(join(repoRoot, 'README.md'), 'hello\n', 'utf-8')
    execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync('git', ['branch', 'feature/memory'], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync('git', ['worktree', 'add', worktreeRoot, 'feature/memory'], { cwd: repoRoot, stdio: 'pipe' })

    expect(projectMemoryKey(repoRoot)).toBe(projectMemoryKey(worktreeRoot))
    expect(getProjectMemoryPath(repoRoot)).toBe(getProjectMemoryPath(worktreeRoot))
  })

  it('uses the remote identity so different clones of the same repo share the same project key', () => {
    const remoteRoot = tempDir('magpie-memory-remote-')
    const seedRoot = tempDir('magpie-memory-seed-')
    const cloneA = tempDir('magpie-memory-clone-a-')
    const cloneB = tempDir('magpie-memory-clone-b-')

    execFileSync('git', ['init', '--bare', remoteRoot], { stdio: 'pipe' })
    execFileSync('git', ['init', '-b', 'main'], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: seedRoot, stdio: 'pipe' })
    writeFileSync(join(seedRoot, 'README.md'), 'seed\n', 'utf-8')
    execFileSync('git', ['add', 'README.md'], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: seedRoot, stdio: 'pipe' })
    execFileSync('git', ['clone', remoteRoot, cloneA], { stdio: 'pipe' })
    execFileSync('git', ['clone', remoteRoot, cloneB], { stdio: 'pipe' })

    expect(projectMemoryKey(cloneA)).toBe(projectMemoryKey(cloneB))
  })
})

import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getRepoCapabilitySessionsDir,
  getRepoMagpieDir,
  getRepoSessionDir,
  getRepoSessionScopedDir,
} from '../../src/platform/paths.js'

describe('repo-local path helpers', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('anchors repo-local session paths at the git repository root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'magpie-paths-repo-'))
    tempDirs.push(repoRoot)
    const nestedDir = join(repoRoot, 'packages', 'checkout')
    mkdirSync(nestedDir, { recursive: true })
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'pipe' })
    const normalizedRepoRoot = realpathSync(repoRoot)

    expect(getRepoMagpieDir(nestedDir)).toBe(join(normalizedRepoRoot, '.magpie'))
    expect(getRepoCapabilitySessionsDir(nestedDir, 'loop')).toBe(join(normalizedRepoRoot, '.magpie', 'sessions', 'loop'))
    expect(getRepoSessionDir(nestedDir, 'harness', 'harness-1')).toBe(join(normalizedRepoRoot, '.magpie', 'sessions', 'harness', 'harness-1'))
    expect(getRepoSessionScopedDir(nestedDir, 'harness', 'harness-1', 'uploads')).toBe(
      join(normalizedRepoRoot, '.magpie', 'sessions', 'harness', 'harness-1', 'uploads')
    )
  })
})

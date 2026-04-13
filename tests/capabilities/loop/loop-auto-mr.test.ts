import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}))

import { createLoopMr, extractMergeRequestUrl } from '../../../src/capabilities/loop/domain/auto-mr.js'

describe('loop auto mr helper', () => {
  afterEach(() => {
    execFileSyncMock.mockReset()
  })

  it('extracts a merge request url from git push output', () => {
    expect(extractMergeRequestUrl(`
remote:
remote: View merge request for sch/demo:
remote:   https://gitlab.example.com/group/project/-/merge_requests/123
remote:
`)).toBe('https://gitlab.example.com/group/project/-/merge_requests/123')
  })

  it('returns success with mr url when git push output contains a merge request link', async () => {
    execFileSyncMock.mockReturnValue(`
remote:
remote: View merge request for sch/demo:
remote:   https://gitlab.example.com/group/project/-/merge_requests/123
remote:
`)

    const result = await createLoopMr({
      cwd: '/tmp/repo',
      branchName: 'sch/demo',
      goal: 'Deliver auto mr',
    })

    expect(result.status).toBe('created')
    expect(result.url).toBe('https://gitlab.example.com/group/project/-/merge_requests/123')
    expect(result.needsHuman).toBe(false)
  })

  it('returns manual follow-up when mr creation fails', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('git push failed: remote rejected')
    })

    const result = await createLoopMr({
      cwd: '/tmp/repo',
      branchName: 'sch/demo',
      goal: 'Deliver auto mr',
    })

    expect(result.status).toBe('manual_follow_up')
    expect(result.needsHuman).toBe(true)
    expect(result.reason).toContain('git push failed')
  })

  it('prefers the repository mr sync script when it exists', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-loop-auto-mr-'))
    mkdirSync(join(repoDir, 'scripts'), { recursive: true })
    writeFileSync(join(repoDir, 'scripts', 'gitlab_mr_sync.sh'), '#!/bin/sh\nexit 0\n', 'utf-8')
    execFileSyncMock.mockReturnValue('https://gitlab.example.com/group/project/-/merge_requests/456')

    await createLoopMr({
      cwd: repoDir,
      branchName: 'sch/demo',
      goal: 'Deliver auto mr',
    })

    expect(execFileSyncMock).toHaveBeenCalledWith(
      join(repoDir, 'scripts', 'gitlab_mr_sync.sh'),
      [],
      expect.objectContaining({ cwd: repoDir, encoding: 'utf-8' })
    )
  })
})

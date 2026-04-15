import { mkdtempSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { createImRuntime, loadImServerStatus, saveImServerStatus } from '../../../src/platform/integrations/im/runtime.js'

describe('im runtime', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('ignores duplicate callback event ids', async () => {
    const tmpRepo = mkdtempSync(join(tmpdir(), 'magpie-im-runtime-'))
    dirs.push(tmpRepo)

    const runtime = createImRuntime(tmpRepo)
    expect(await runtime.markEventProcessed('evt-1')).toBe(true)
    expect(await runtime.markEventProcessed('evt-1')).toBe(false)
  })

  it('persists and reloads im server status', async () => {
    const tmpRepo = mkdtempSync(join(tmpdir(), 'magpie-im-runtime-'))
    dirs.push(tmpRepo)

    await saveImServerStatus(tmpRepo, {
      providerId: 'feishu_main',
      status: 'running',
      port: 9321,
      path: '/callbacks/feishu',
      updatedAt: '2026-04-15T08:00:00.000Z',
    })

    const status = await loadImServerStatus(tmpRepo)
    expect(status?.status).toBe('running')
    expect(status?.port).toBe(9321)

    const raw = await readFile(join(tmpRepo, '.magpie', 'im', 'server-state.json'), 'utf-8')
    expect(raw).toContain('"providerId": "feishu_main"')
  })
})

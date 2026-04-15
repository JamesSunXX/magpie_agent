import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadThreadMappingBySession,
  loadThreadMappingByThread,
  saveThreadMapping,
} from '../../../src/platform/integrations/im/thread-mapping.js'

describe('thread mapping storage', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('saves and reloads one thread mapping per task', async () => {
    const tmpRepo = mkdtempSync(join(tmpdir(), 'magpie-im-thread-'))
    dirs.push(tmpRepo)

    await saveThreadMapping(tmpRepo, {
      threadId: 'om_root',
      rootMessageId: 'om_root',
      chatId: 'oc_chat',
      capability: 'loop',
      sessionId: 'loop-123',
      status: 'paused_for_human',
      lastEventId: 'evt-1',
    })

    const record = await loadThreadMappingBySession(tmpRepo, 'loop', 'loop-123')
    expect(record?.threadId).toBe('om_root')
    expect(record?.lastEventId).toBe('evt-1')
  })

  it('can load a mapping by thread id', async () => {
    const tmpRepo = mkdtempSync(join(tmpdir(), 'magpie-im-thread-'))
    dirs.push(tmpRepo)

    await saveThreadMapping(tmpRepo, {
      threadId: 'om_root',
      rootMessageId: 'om_root',
      chatId: 'oc_chat',
      capability: 'harness',
      sessionId: 'harness-456',
      status: 'queued',
    })

    const record = await loadThreadMappingByThread(tmpRepo, 'om_root')
    expect(record?.capability).toBe('harness')
    expect(record?.sessionId).toBe('harness-456')
  })
})

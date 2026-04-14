import { beforeEach, describe, expect, it, vi } from 'vitest'

const openSyncMock = vi.hoisted(() => vi.fn())
const readSyncMock = vi.hoisted(() => vi.fn())
const writeSyncMock = vi.hoisted(() => vi.fn())
const closeSyncMock = vi.hoisted(() => vi.fn())

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    openSync: openSyncMock,
    readSync: readSyncMock,
    writeSync: writeSyncMock,
    closeSync: closeSyncMock,
  }
})

import { enforceCommandSafety } from '../../../../src/capabilities/workflows/shared/runtime.js'

describe('workflow shared runtime interactive safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows a dangerous command when the interactive confirmation says yes', () => {
    openSyncMock
      .mockReturnValueOnce(11)
      .mockReturnValueOnce(12)
    readSyncMock.mockImplementation((_fd, buffer: Buffer) => {
      buffer.write('yes\n')
      return 4
    })

    const result = enforceCommandSafety('rm -rf dist', { interactive: true })

    expect(result).toBeNull()
    expect(writeSyncMock).toHaveBeenCalled()
    expect(closeSyncMock).toHaveBeenCalledTimes(2)
  })

  it('blocks the command when tty confirmation cannot be read', () => {
    openSyncMock.mockImplementation(() => {
      throw new Error('tty unavailable')
    })

    const result = enforceCommandSafety('rm -rf dist', { interactive: true })

    expect(result?.passed).toBe(false)
    expect(result?.blocked).toBe(true)
    expect(result?.output).toContain('Dangerous command blocked')
  })
})

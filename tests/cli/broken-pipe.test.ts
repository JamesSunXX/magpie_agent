import { afterEach, describe, expect, it, vi } from 'vitest'

describe('CLI broken pipe handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('exits cleanly when stdout is closed by the downstream pipe', async () => {
    const parse = vi.fn()

    vi.doMock('../../src/cli/program.js', () => ({
      createProgram: () => ({
        parse,
      }),
    }))

    const existingListeners = new Set(process.stdout.listeners('error'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? ''}`)
    }) as never)

    await import('../../src/cli.ts')

    expect(parse).toHaveBeenCalled()

    const handler = process.stdout
      .listeners('error')
      .find((listener) => !existingListeners.has(listener))

    expect(handler).toBeTypeOf('function')
    expect(() => (handler as (error: NodeJS.ErrnoException) => void)(
      Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    )).toThrow('process.exit:0')
    expect(exitSpy).toHaveBeenCalledWith(0)

    if (handler) {
      process.stdout.removeListener('error', handler)
    }
  })
})

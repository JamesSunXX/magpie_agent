import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

describe('loop CLI runtime command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockReturnValue({ name: 'loop' })
  })

  it('runs loop run through the capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockResolvedValue({
      output: {
        summary: 'Loop completed successfully.',
        details: {
          id: 'loop-1',
          status: 'completed',
          branchName: 'sch/loop-1',
          artifacts: {
            humanConfirmationPath: '/tmp/human_confirmation.md',
          },
        },
      },
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    await loopCommand.parseAsync(
      ['node', 'loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'loop')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'loop' },
      expect.objectContaining({
        mode: 'run',
        goal: 'Ship checkout v2',
        prdPath: '/tmp/prd.md',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Session: loop-1')
    expect(logSpy).toHaveBeenCalledWith('Branch: sch/loop-1')
    expect(logSpy).toHaveBeenCalledWith('Human confirmation file: /tmp/human_confirmation.md')
    logSpy.mockRestore()
  })

  it('runs loop resume through the capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockResolvedValue({
      output: {
        summary: 'Loop resumed.',
        details: {
          id: 'loop-2',
          status: 'paused_for_human',
          artifacts: {
            humanConfirmationPath: '/tmp/human_confirmation.md',
          },
        },
      },
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    await loopCommand.parseAsync(
      ['node', 'loop', 'resume', 'loop-2'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'loop' },
      expect.objectContaining({
        mode: 'resume',
        sessionId: 'loop-2',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Session: loop-2')
    logSpy.mockRestore()
  })

  it('prints a friendly message when no loop sessions exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockResolvedValue({
      output: {
        summary: 'No loop sessions found.',
        details: [],
      },
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    await loopCommand.parseAsync(
      ['node', 'loop', 'list'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('No loop sessions found.')
    logSpy.mockRestore()
  })

  it('prints loop sessions for list mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockResolvedValue({
      output: {
        summary: 'Loop sessions listed.',
        details: [
          {
            id: 'loop-2',
            status: 'completed',
            updatedAt: new Date('2026-04-11T01:00:00.000Z'),
            title: 'Checkout',
          },
        ],
      },
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    await loopCommand.parseAsync(
      ['node', 'loop', 'list'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('loop-2\tcompleted\t2026-04-11T01:00:00.000Z\tCheckout')
    logSpy.mockRestore()
  })
})

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

describe('capability runtime CLI commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    runCapability.mockResolvedValue({
      output: { summary: 'done' },
      result: { payload: { exitCode: 0 } },
    })
  })

  it('dispatches review through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'review' })
    const { reviewCommand } = await import('../../src/cli/commands/review.js')

    await reviewCommand.parseAsync(['node', 'review', '123', '--format', 'json', '--reviewers', 'claude'], {
      from: 'node',
    })

    expect(createDefaultCapabilityRegistry).toHaveBeenCalled()
    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'review')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'review' },
      expect.objectContaining({
        target: '123',
        options: expect.objectContaining({
          format: 'json',
          reviewers: 'claude',
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches discuss through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'discuss' })
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', 'topic', '--rounds', '2', '--reviewers', 'claude', '--plan-report'], {
      from: 'node',
    })

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'discuss')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'discuss' },
      expect.objectContaining({
        topic: 'topic',
        options: expect.objectContaining({
          rounds: '2',
          reviewers: 'claude',
          planReport: true,
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches trd through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'trd' })
    const { trdCommand } = await import('../../src/cli/commands/trd.js')

    await trdCommand.parseAsync(
      ['node', 'trd', '/tmp/prd.md', '--reviewers', 'claude', '--auto-accept-domains'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'trd')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'trd' },
      expect.objectContaining({
        prdPath: '/tmp/prd.md',
        options: expect.objectContaining({
          reviewers: 'claude',
          autoAcceptDomains: true,
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches stats through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'stats' })
    const { statsCommand } = await import('../../src/cli/commands/stats.js')

    await statsCommand.parseAsync(['node', 'stats', '--since', '14', '--format', 'json'], {
      from: 'node',
    })

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'stats')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'stats' },
      {
        since: 14,
        format: 'json',
      },
      expect.any(Object)
    )
  })
})

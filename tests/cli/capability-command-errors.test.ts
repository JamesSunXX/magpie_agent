import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCapability = vi.fn()
const createCapabilityContext = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/context.js', () => ({
  createCapabilityContext,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

describe('capability-backed CLI command errors', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.exitCode = 0

    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockReturnValue({ name: 'capability' })
    createCapabilityContext.mockReturnValue({ cwd: '/tmp/project' })
    runCapability.mockRejectedValue(new Error('bad config'))
  })

  it('prints a deterministic error and sets exit code for review', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reviewCommand } = await import('../../src/cli/commands/review.js')

    await reviewCommand.parseAsync(['node', 'test', '123'], { from: 'node' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: bad config'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('prints a deterministic error and sets exit code for discuss', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'test', 'topic'], { from: 'node' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: bad config'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('prints a deterministic error and sets exit code for trd', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { trdCommand } = await import('../../src/cli/commands/trd.js')

    await trdCommand.parseAsync(['node', 'test', '/tmp/prd.md'], { from: 'node' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: bad config'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('prints a deterministic error and sets exit code for stats', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { statsCommand } = await import('../../src/cli/commands/stats.js')

    await statsCommand.parseAsync(['node', 'test', '--since', '7'], { from: 'node' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad config'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('prints a deterministic error and sets exit code for workflow harness', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(['node', 'workflow', 'harness', 'ship fix', '--prd', '/tmp/prd.md'], {
      from: 'node',
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('harness failed: bad config'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})

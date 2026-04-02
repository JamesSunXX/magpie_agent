import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportDiscussSession = vi.fn()
const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()

vi.mock('../../src/capabilities/discuss/application/export.js', () => ({
  exportDiscussSession,
  validateDiscussExportOptions: vi.fn((options: { export?: string; planReport?: boolean }) => {
    if (options.planReport && !options.export) {
      return '--plan-report requires --export <id>'
    }
    return undefined
  }),
}))

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

describe('discuss export command', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.exitCode = 0

    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockReturnValue({ name: 'discuss' })
    runCapability.mockResolvedValue({
      output: { summary: 'done' },
      result: { payload: { exitCode: 0 } },
    })
  })

  it('prints an error when --plan-report is used without --export', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', 'topic', '--plan-report'], {
      from: 'node',
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--plan-report requires --export <id>'))
    expect(runCapability).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })

  it('exports a plan report and prints a Plan artifact line', async () => {
    exportDiscussSession.mockResolvedValue({
      kind: 'plan',
      outputFile: '/tmp/discuss-plan-disc-1234.md',
      sessionId: 'disc-1234',
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', '--export', 'disc-1234', '--plan-report'], {
      from: 'node',
    })

    expect(exportDiscussSession).toHaveBeenCalledWith({
      options: expect.objectContaining({
        export: 'disc-1234',
        planReport: true,
      }),
      cwd: process.cwd(),
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Plan: /tmp/discuss-plan-disc-1234.md'))
    expect(runCapability).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  it('exports a standard discussion session without printing a Plan artifact line', async () => {
    exportDiscussSession.mockResolvedValue({
      kind: 'discussion',
      outputFile: '/tmp/discuss-disc-1234.md',
      sessionId: 'disc-1234',
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', '--export', 'disc-1234'], {
      from: 'node',
    })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Exported session disc-1234'))
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Plan:'))

    logSpy.mockRestore()
  })

  it('prints a list hint when export fails because the session is missing', async () => {
    exportDiscussSession.mockRejectedValue(new Error('No session found matching "disc-1234"'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', '--export', 'disc-1234'], {
      from: 'node',
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No session found matching "disc-1234"'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Use magpie discuss --list'))
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })
})

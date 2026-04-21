import { beforeEach, describe, expect, it, vi } from 'vitest'

const runDoctorChecks = vi.fn()

vi.mock('../../src/capabilities/stats/application/doctor.js', () => ({
  runDoctorChecks,
}))

describe('doctor CLI command', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.exitCode = 0
  })

  it('prints a passing summary and keeps zero exit code', async () => {
    runDoctorChecks.mockReturnValue({
      configPath: '/tmp/config.yaml',
      checks: [
        {
          id: 'config_file',
          title: 'Config file',
          status: 'pass',
          message: 'Found config file.',
        },
        {
          id: 'config_schema',
          title: 'Config schema',
          status: 'pass',
          message: 'Config can be loaded.',
        },
      ],
      summary: {
        pass: 2,
        warn: 0,
        fail: 0,
      },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { doctorCommand } = await import('../../src/cli/commands/doctor.js')

    await doctorCommand.parseAsync(['node', 'doctor', '--config', '/tmp/config.yaml'], { from: 'node' })

    expect(runDoctorChecks).toHaveBeenCalledWith({
      cwd: process.cwd(),
      configPath: '/tmp/config.yaml',
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Doctor summary: 2 passed, 0 warnings, 0 failed.'))
    expect(errorSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('prints fixes and sets exit code when failures exist', async () => {
    runDoctorChecks.mockReturnValue({
      configPath: '/tmp/config.yaml',
      checks: [
        {
          id: 'openai_api_key',
          title: 'OPENAI_API_KEY',
          status: 'fail',
          message: 'Missing OPENAI_API_KEY.',
          fixCommand: 'export OPENAI_API_KEY=your_key_here',
        },
      ],
      summary: {
        pass: 0,
        warn: 0,
        fail: 1,
      },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { doctorCommand } = await import('../../src/cli/commands/doctor.js')

    await doctorCommand.parseAsync(['node', 'doctor'], { from: 'node' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fix: export OPENAI_API_KEY=your_key_here'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Doctor found blocking issues'))
    expect(process.exitCode).toBe(1)

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

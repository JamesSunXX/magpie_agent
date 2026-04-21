import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConfigVersionStatus, loadConfig } = vi.hoisted(() => ({
  getConfigVersionStatus: vi.fn(),
  loadConfig: vi.fn(),
}))

vi.mock('../../src/platform/config/loader.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/platform/config/loader.js')>('../../src/platform/config/loader.js')
  return {
    ...actual,
    getConfigVersionStatus,
    loadConfig,
  }
})
import { createProgram } from '../../src/cli/program.js'

describe('CLI program', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    getConfigVersionStatus.mockReturnValue({
      path: '/tmp/config.yaml',
      expectedVersion: 1,
      state: 'current',
    })
    loadConfig.mockReturnValue({
      capabilities: {},
    })
  })

  it('registers the tui command', () => {
    const program = createProgram()

    expect(program.commands.some((command) => command.name() === 'tui')).toBe(true)
  })

  it('registers memory as a top-level command', () => {
    const program = createProgram()

    expect(program.commands.some((command) => command.name() === 'memory')).toBe(true)
  })

  it('registers reviewers command with list subcommand', () => {
    const program = createProgram()
    const reviewers = program.commands.find((command) => command.name() === 'reviewers')

    expect(reviewers).toBeTruthy()
    expect(reviewers?.commands.some((subcommand) => subcommand.name() === 'list')).toBe(true)
  })

  it('registers workflow command with issue-fix, docs-sync, harness, and post-merge-regression subcommands', () => {
    const program = createProgram()
    const workflow = program.commands.find((command) => command.name() === 'workflow')

    expect(workflow).toBeTruthy()
    expect(workflow?.commands.map((subcommand) => subcommand.name())).toEqual([
      'issue-fix',
      'docs-sync',
      'harness',
      'post-merge-regression',
    ])
  })

  it('registers top-level harness command with submit, status, resume, confirm, attach, inspect, approve, reject, and list subcommands', () => {
    const program = createProgram()
    const harness = program.commands.find((command) => command.name() === 'harness')

    expect(harness).toBeTruthy()
    expect(harness?.commands.map((subcommand) => subcommand.name())).toEqual([
      'submit',
      'status',
      'resume',
      'confirm',
      'attach',
      'inspect',
      'approve',
      'reject',
      'list',
    ])
  })

  it('registers top-level harness-server command with start, stop, and status subcommands', () => {
    const program = createProgram()
    const harnessServer = program.commands.find((command) => command.name() === 'harness-server')

    expect(harnessServer).toBeTruthy()
    expect(harnessServer?.commands.map((subcommand) => subcommand.name())).toEqual([
      'start',
      'status',
      'stop',
      'run',
    ])
  })

  it('registers top-level im-server command with start, status, and stop subcommands', () => {
    const program = createProgram()
    const imServer = program.commands.find((command) => command.name() === 'im-server')

    expect(imServer).toBeTruthy()
    expect(imServer?.commands.map((subcommand) => subcommand.name())).toEqual([
      'start',
      'status',
      'stop',
      'run',
    ])
  })

  it('registers loop inspect alongside run, resume, confirm, and list', () => {
    const program = createProgram()
    const loop = program.commands.find((command) => command.name() === 'loop')

    expect(loop).toBeTruthy()
    expect(loop?.commands.map((subcommand) => subcommand.name())).toEqual([
      'run',
      'resume',
      'confirm',
      'inspect',
      'list',
    ])
  })

  it('registers stats as a top-level command', () => {
    const program = createProgram()
    const stats = program.commands.find((command) => command.name() === 'stats')

    expect(stats).toBeTruthy()
  })

  it('registers status and skills as top-level commands', () => {
    const program = createProgram()
    const status = program.commands.find((command) => command.name() === 'status')
    const skills = program.commands.find((command) => command.name() === 'skills')

    expect(status).toBeTruthy()
    expect(skills).toBeTruthy()
    expect(skills?.commands.map((subcommand) => subcommand.name())).toEqual([
      'list',
      'inspect',
      'enable',
      'disable',
    ])
  })

  it('registers doctor as a top-level command', () => {
    const program = createProgram()
    const doctor = program.commands.find((command) => command.name() === 'doctor')

    expect(doctor).toBeTruthy()
  })

  it('documents repo review as a valid mode without a PR argument', () => {
    const program = createProgram()
    const review = program.commands.find((command) => command.name() === 'review')
    const help = review?.helpInformation().replace(/\s+/g, ' ')

    expect(help).toContain(
      'PR number or URL (optional if using --local, --branch, --files, or --repo)'
    )
  })

  it('registers explicit planning target options for loop run and workflow issue-fix', () => {
    const program = createProgram()
    const loop = program.commands.find((command) => command.name() === 'loop')
    const workflow = program.commands.find((command) => command.name() === 'workflow')
    const loopRun = loop?.commands.find((subcommand) => subcommand.name() === 'run')
    const issueFix = workflow?.commands.find((subcommand) => subcommand.name() === 'issue-fix')
    const workflowHarness = workflow?.commands.find((subcommand) => subcommand.name() === 'harness')
    const topLevelHarness = program.commands.find((command) => command.name() === 'harness')
      ?.commands.find((subcommand) => subcommand.name() === 'submit')

    const loopOptionFlags = loopRun?.options.map((option) => option.long) || []
    const issueFixOptionFlags = issueFix?.options.map((option) => option.long) || []
    const workflowHarnessFlags = workflowHarness?.options.map((option) => option.long) || []
    const topLevelHarnessFlags = topLevelHarness?.options.map((option) => option.long) || []

    expect(loopOptionFlags).toContain('--planning-item')
    expect(loopOptionFlags).toContain('--planning-project')
    expect(loopOptionFlags).toContain('--complexity')
    expect(loopOptionFlags).toContain('--host')
    expect(issueFixOptionFlags).toContain('--planning-item')
    expect(issueFixOptionFlags).toContain('--planning-project')
    expect(issueFixOptionFlags).toContain('--complexity')
    expect(workflowHarnessFlags).toContain('--host')
    expect(topLevelHarnessFlags).toContain('--host')
    expect(topLevelHarnessFlags).toContain('--priority')
  })

  it('warns before command execution when config version is outdated', async () => {
    getConfigVersionStatus.mockReturnValue({
      path: '/tmp/config.yaml',
      configVersion: 0,
      expectedVersion: 1,
      state: 'outdated',
      message: 'Config version is outdated. Run `magpie init --upgrade --config /tmp/config.yaml`.',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const action = vi.fn()
    const program = createProgram()
    program
      .command('sample')
      .option('-c, --config <path>')
      .action(action)

    await program.parseAsync(['node', 'magpie', 'sample', '--config', '/tmp/config.yaml'], { from: 'node' })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Config version is outdated'))
    expect(action).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not print pre-action config warning for doctor', async () => {
    getConfigVersionStatus.mockReturnValue({
      path: '/tmp/config.yaml',
      configVersion: 0,
      expectedVersion: 1,
      state: 'outdated',
      message: 'Config version is outdated. Run `magpie init --upgrade --config /tmp/config.yaml`.',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const program = createProgram()

    await program.parseAsync(['node', 'magpie', 'doctor', '--config', '/tmp/config.yaml'], { from: 'node' })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(loadConfig).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('blocks command execution when the mapped capability is disabled', async () => {
    loadConfig.mockReturnValue({
      capabilities: {
        docs_sync: { enabled: false },
      },
    })

    const program = createProgram()
    program.exitOverride()
    let error: unknown

    try {
      await program.parseAsync(['node', 'magpie', 'workflow', 'docs-sync', '--config', '/tmp/config.yaml'], { from: 'node' })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      code: 'magpie.capabilityDisabled',
      exitCode: 1,
    })
    expect(String((error as Error).message)).toContain('Capability "docs-sync" is currently disabled.')
    expect(String((error as Error).message)).toContain('capabilities.docs_sync.enabled: true')
    expect(String((error as Error).message)).toContain('magpie review --repo')
  })
})

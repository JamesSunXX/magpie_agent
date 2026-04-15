import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatExpectedLocalDateTime } from '../helpers/local-time.js'
import { StateManager } from '../../src/state/state-manager.js'
import type { LoopSession } from '../../src/state/types.js'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()
const launchMagpieInTmux = vi.fn()

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

vi.mock('../../src/cli/commands/tmux-launch.js', () => ({
  launchMagpieInTmux,
}))

describe('loop CLI runtime command', () => {
  let magpieHome: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockImplementation((_registry, name) => ({ name }))
    launchMagpieInTmux.mockResolvedValue({
      sessionId: 'loop-tmux-1',
      tmuxSession: 'magpie-loop-tmux-1',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
  })

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
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

  it('forwards host overrides and prints workspace metadata', async () => {
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
            workspaceMode: 'worktree',
            workspacePath: '/tmp/.worktrees/sch/loop-1',
            worktreeBranch: 'sch/loop-1',
            executionHost: 'tmux',
            tmuxSession: 'magpie-loop-1',
            tmuxWindow: '@1',
            tmuxPane: '%1',
          },
        },
      },
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    await loopCommand.parseAsync(
      ['node', 'loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'loop' },
      expect.objectContaining({
        host: 'tmux',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Workspace: /tmp/.worktrees/sch/loop-1 (worktree)')
    expect(logSpy).toHaveBeenCalledWith('Host: tmux')
    expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-loop-1 window=@1 pane=%1')
    logSpy.mockRestore()
  })

  it('launches loop runs in tmux when requested outside the test host', async () => {
    const previousVitest = process.env.VITEST
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.VITEST = ''

    try {
      const { loopCommand } = await import('../../src/cli/commands/loop.js')
      await loopCommand.parseAsync(
        ['node', 'loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux', '--no-wait-human'],
        { from: 'node' }
      )

      expect(launchMagpieInTmux).toHaveBeenCalledWith({
        capability: 'loop',
        cwd: process.cwd(),
        configPath: undefined,
        argv: [
          'loop',
          'run',
          'Ship checkout v2',
          '--prd',
          '/tmp/prd.md',
          '--host',
          'foreground',
          '--no-wait-human',
        ],
      })
      expect(runCapability).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith('Session: loop-tmux-1')
      expect(logSpy).toHaveBeenCalledWith('Host: tmux')
      expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-loop-tmux-1 window=@1 pane=%1')
    } finally {
      process.env.VITEST = previousVitest
      logSpy.mockRestore()
    }
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

    expect(logSpy).toHaveBeenCalledWith(`loop-2\tcompleted\t${formatExpectedLocalDateTime('2026-04-11T01:00:00.000Z')}\tCheckout`)
    logSpy.mockRestore()
  })

  it('approves the latest pending confirmation and resumes the loop automatically', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-loop-confirm-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-loop-confirm-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()
    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-confirm-1')
    mkdirSync(sessionDir, { recursive: true })

    const confirmationPath = join(sessionDir, 'human_confirmation.md')
    writeFileSync(confirmationPath, `# Human Confirmation Queue

<!-- MAGPIE_HUMAN_CONFIRMATION_START -->

\`\`\`yaml
id: hc-stale
session_id: loop-confirm-1
stage: code_development
status: pending
decision: pending
reason: Old file-only pending item
next_action: Continue
created_at: 2026-04-10T00:00:00.000Z
updated_at: 2026-04-10T00:00:00.000Z
\`\`\`
<!-- MAGPIE_HUMAN_CONFIRMATION_END -->

<!-- MAGPIE_HUMAN_CONFIRMATION_START -->

\`\`\`yaml
id: hc-file
session_id: loop-confirm-1
stage: code_development
status: pending
decision: pending
reason: File copy should not override session state
next_action: Approve or reject
created_at: 2026-04-11T00:00:00.000Z
updated_at: 2026-04-11T00:00:00.000Z
\`\`\`
<!-- MAGPIE_HUMAN_CONFIRMATION_END -->
`, 'utf-8')

    const session: LoopSession = {
      id: 'loop-confirm-1',
      title: 'Confirm loop',
      goal: 'Ship checkout',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:05:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development'],
      plan: [],
      stageResults: [],
      humanConfirmations: [{
        id: 'hc-pending',
        sessionId: 'loop-confirm-1',
        stage: 'code_development',
        status: 'pending',
        decision: 'pending',
        reason: 'Need one final product decision',
        artifacts: [],
        nextAction: 'Approve or reject',
        createdAt: new Date('2026-04-11T00:00:00.000Z'),
        updatedAt: new Date('2026-04-11T00:00:00.000Z'),
      }],
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: confirmationPath,
      },
    }
    await state.saveLoopSession(session)

    runCapability.mockResolvedValue({
      output: {
        summary: 'Loop resumed.',
        details: {
          id: 'loop-confirm-1',
          status: 'running',
          artifacts: {
            humanConfirmationPath: confirmationPath,
          },
        },
      },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    const previousCwd = process.cwd()

    try {
      process.chdir(cwd)
      await loopCommand.parseAsync(
        ['node', 'loop', 'confirm', 'loop-confirm-1', '--approve'],
        { from: 'node' }
      )
    } finally {
      process.chdir(previousCwd)
      logSpy.mockRestore()
    }

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'loop' },
      expect.objectContaining({
        mode: 'resume',
        sessionId: 'loop-confirm-1',
        waitHuman: false,
      }),
      expect.any(Object)
    )

    const content = readFileSync(confirmationPath, 'utf-8')
    expect(content).toContain('id: hc-pending')
    expect(content).toContain('status: approved')
    expect(content).toContain('decision: approved')
    expect(content).not.toContain('id: hc-stale')
    expect(content).not.toContain('id: hc-file')

    const persisted = await state.loadLoopSession('loop-confirm-1')
    expect(persisted?.humanConfirmations.map((item) => item.id)).toEqual(['hc-pending'])
    expect(persisted?.humanConfirmations[0]).toMatchObject({
      id: 'hc-pending',
      status: 'approved',
      decision: 'approved',
    })
  })

  it('rejects the latest pending confirmation, runs auto-discuss, and creates a new pending card', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-loop-confirm-reject-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-loop-confirm-reject-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()
    await state.initDiscussions()
    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-confirm-2')
    mkdirSync(sessionDir, { recursive: true })

    const confirmationPath = join(sessionDir, 'human_confirmation.md')
    writeFileSync(confirmationPath, `# Human Confirmation Queue

<!-- MAGPIE_HUMAN_CONFIRMATION_START -->

\`\`\`yaml
id: hc-pending
session_id: loop-confirm-2
stage: code_development
status: pending
decision: pending
reason: Need one final product decision
next_action: Approve or reject
created_at: 2026-04-11T00:00:00.000Z
updated_at: 2026-04-11T00:00:00.000Z
\`\`\`
<!-- MAGPIE_HUMAN_CONFIRMATION_END -->
`, 'utf-8')

    const session: LoopSession = {
      id: 'loop-confirm-2',
      title: 'Reject loop',
      goal: 'Ship checkout',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:05:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['code_development'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir,
        eventsPath: join(sessionDir, 'events.jsonl'),
        planPath: join(sessionDir, 'plan.json'),
        humanConfirmationPath: confirmationPath,
      },
    }
    await state.saveLoopSession(session)

    runCapability.mockImplementation(async (capability, _input, ctx) => {
      if (capability.name === 'discuss') {
        await state.saveDiscussSession({
          id: 'disc-1001',
          title: 'Auto discussion',
          createdAt: new Date('2026-04-11T00:10:00.000Z'),
          updatedAt: new Date('2026-04-11T00:10:00.000Z'),
          status: 'completed',
          reviewerIds: ['reviewer-a', 'reviewer-b'],
          rounds: [{
            roundNumber: 1,
            topic: 'Auto discussion',
            analysis: 'analysis',
            messages: [],
            summaries: [],
            conclusion: '结论：建议继续，但先补上回滚说明和接口测试。',
            timestamp: new Date('2026-04-11T00:10:00.000Z'),
          }],
        })
        return {
          output: {
            summary: 'Discussion completed for disc-1001.',
          },
          result: {
            status: 'completed',
            payload: {
              exitCode: 0,
              summary: 'Discussion completed for disc-1001.',
            },
          },
        }
      }

      throw new Error(`Unexpected capability ${capability.name}`)
    })

    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    const previousCwd = process.cwd()

    try {
      process.chdir(cwd)
      await loopCommand.parseAsync(
        ['node', 'loop', 'confirm', 'loop-confirm-2', '--reject', '--reason', '不同意，先补测试'],
        { from: 'node' }
      )
    } finally {
      process.chdir(previousCwd)
    }

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'discuss' },
      expect.objectContaining({
        topic: expect.stringContaining('不同意，先补测试'),
      }),
      expect.any(Object)
    )

    const content = readFileSync(confirmationPath, 'utf-8')
    expect(content).toContain('id: hc-pending')
    expect(content).toContain('status: rejected')
    expect(content).toContain('decision: rejected')
    expect(content).toContain('discussion_session_id: disc-1001')
    expect(content).toContain('status: pending')
    expect(content).toContain('parent_id: hc-pending')

    const persisted = await state.loadLoopSession('loop-confirm-2')
    expect(persisted?.humanConfirmations).toHaveLength(2)
    expect(persisted?.humanConfirmations[0]).toMatchObject({
      id: 'hc-pending',
      status: 'rejected',
      decision: 'rejected',
      rationale: '不同意，先补测试',
    })
    expect(persisted?.humanConfirmations[1]).toMatchObject({
      parentId: 'hc-pending',
      discussionSessionId: 'disc-1001',
      status: 'pending',
      decision: 'pending',
    })
  })
})

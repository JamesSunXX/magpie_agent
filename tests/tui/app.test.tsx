import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, BuiltCommand, RunState } from '../../src/tui/types.js'

const mockUseState = vi.fn()
const mockUseEffect = vi.fn()
const mockUseInput = vi.fn()
const exit = vi.fn()
const loadSessionDashboard = vi.fn()
const inspectEnvironmentHealth = vi.fn()
const run = vi.fn()
const createRunController = vi.fn(() => ({ run }))
const loadGraphWorkbench = vi.fn()

let capturedInput:
  | ((input: string, key: Record<string, boolean | undefined>) => void)
  | undefined

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')

  return {
    ...actual,
    default: actual.default,
    useState: mockUseState,
    useEffect: mockUseEffect,
  }
})

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')

  return {
    ...actual,
    useApp: () => ({ exit }),
    useInput: (handler: (input: string, key: Record<string, boolean | undefined>) => void) => {
      capturedInput = handler
      mockUseInput(handler)
    },
  }
})

vi.mock('../../src/tui/session-dashboard.js', () => ({
  loadSessionDashboard,
}))

vi.mock('../../src/tui/environment-health.js', () => ({
  inspectEnvironmentHealth,
}))

vi.mock('../../src/tui/run-controller.js', () => ({
  createRunController,
}))

vi.mock('../../src/tui/graph-workbench-loader.js', () => ({
  loadGraphWorkbench,
}))

function flushPromises(): Promise<void> {
  return Promise.resolve().then(() => undefined)
}

describe('App', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    capturedInput = undefined
    mockUseEffect.mockImplementation(() => undefined)
  })

  it('loads dashboard sessions and environment health on mount', async () => {
    const setState = vi.fn()
    mockUseState.mockReturnValue([
      {
        route: 'dashboard',
        selectedIndex: 0,
        sessions: { continue: [], recent: [] },
      } satisfies AppState,
      setState,
    ])
    mockUseEffect.mockImplementation((effect: () => void | (() => void)) => {
      effect()
    })
    loadSessionDashboard.mockResolvedValue({ continue: [], recent: [] })
    inspectEnvironmentHealth.mockResolvedValue({ items: [] })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo', configPath: '/tmp/config.yaml' })
    await flushPromises()
    await flushPromises()

    expect(loadSessionDashboard).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(inspectEnvironmentHealth).toHaveBeenCalledWith({
      cwd: '/repo',
      configPath: '/tmp/config.yaml',
    })
    expect(setState).toHaveBeenCalledTimes(1)
  })

  it('starts a wizard from the dashboard and can exit on q', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 0,
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    const element = App({ cwd: '/repo' }) as { props: Record<string, unknown> }

    expect(typeof element.type).toBe('function')
    capturedInput?.('', { return: true })
    const next = setState.mock.calls[0][0](state) as AppState
    expect(next.route).toBe('wizard')

    capturedInput?.('q', {})
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('moves dashboard selection and refreshes dashboard data', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 0,
      sessions: {
        continue: [],
        recent: [
          {
            id: 'review-1',
            capability: 'review',
            title: 'Repo review',
            status: 'completed',
            updatedAt: new Date('2026-03-19T11:00:00.000Z'),
            resumeCommand: ['review', '--session', 'review-1'],
            artifactPaths: [],
          },
        ],
      },
    }
    mockUseState.mockReturnValue([state, setState])
    loadSessionDashboard.mockResolvedValue({ continue: [], recent: [] })
    inspectEnvironmentHealth.mockResolvedValue({ items: [] })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo', configPath: '/tmp/config.yaml' })

    capturedInput?.('', { downArrow: true })
    let next = setState.mock.calls[0][0](state) as AppState
    expect(next.selectedIndex).toBe(1)

    setState.mockClear()
    capturedInput?.('', { upArrow: true })
    next = setState.mock.calls[0][0](state) as AppState
    expect(next.selectedIndex).toBe(5)

    setState.mockClear()
    capturedInput?.('r', {})
    await flushPromises()
    await flushPromises()
    expect(loadSessionDashboard).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(inspectEnvironmentHealth).toHaveBeenCalledWith({
      cwd: '/repo',
      configPath: '/tmp/config.yaml',
    })
    expect(setState).toHaveBeenCalled()
  })

  it('opens a resume preview from the dashboard', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 5,
      sessions: {
        continue: [
          {
            id: 'loop-1',
            capability: 'loop',
            title: 'Paused loop',
            status: 'paused_for_human',
            updatedAt: new Date('2026-03-19T10:00:00.000Z'),
            resumeCommand: ['loop', 'resume', 'loop-1'],
            artifactPaths: ['/tmp/human_confirmation.md'],
          },
        ],
        recent: [],
      },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })
    const next = setState.mock.calls[0][0](state) as AppState
    expect(next.route).toBe('preview')
    expect(next.command?.argv).toEqual(['loop', 'resume', 'loop-1'])
  })

  it('updates wizard values and submits valid drafts to preview', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'wizard',
      activeTaskId: 'issue-fix',
      selectedIndex: 0,
      draft: {
        taskId: 'issue-fix',
        values: {
          issue: '',
        },
        showAdvanced: false,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('A', {})
    const edited = setState.mock.calls[0][0](state) as AppState
    expect(edited.draft?.values.issue).toBe('A')

    setState.mockClear()
    const validState: AppState = {
      ...state,
      draft: {
        ...state.draft!,
        values: {
          issue: 'Crash when opening dashboard',
        },
      },
    }
    mockUseState.mockReturnValue([validState, setState])
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })
    const next = setState.mock.calls[0][0](validState) as AppState
    expect(next.route).toBe('preview')
    expect(next.command?.argv).toEqual(['workflow', 'issue-fix', 'Crash when opening dashboard'])
  })

  it('handles wizard advanced toggles, select cycling, and escape', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'wizard',
      activeTaskId: 'change-review',
      selectedIndex: 0,
      draft: {
        taskId: 'change-review',
        values: {
          mode: 'local',
        },
        showAdvanced: false,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('a', {})
    let next = setState.mock.calls[0][0](state) as AppState
    expect(next.draft?.showAdvanced).toBe(true)

    setState.mockClear()
    capturedInput?.('', { rightArrow: true })
    next = setState.mock.calls[0][0](state) as AppState
    expect(next.draft?.values.mode).toBe('branch')

    setState.mockClear()
    capturedInput?.('', { escape: true })
    next = setState.mock.calls[0][0](state) as AppState
    expect(next.route).toBe('dashboard')
  })

  it('handles wizard navigation, toggle values, and text backspace', async () => {
    const setState = vi.fn()
    const { App } = await import('../../src/tui/app.js')

    const navigationState: AppState = {
      route: 'wizard',
      activeTaskId: 'issue-fix',
      selectedIndex: 0,
      draft: {
        taskId: 'issue-fix',
        values: {
          issue: 'AB',
        },
        showAdvanced: false,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([navigationState, setState])
    App({ cwd: '/repo' })

    capturedInput?.('', { downArrow: true })
    let next = setState.mock.calls[0][0](navigationState) as AppState
    expect(next.selectedIndex).toBe(0)

    setState.mockClear()
    capturedInput?.('', { backspace: true })
    next = setState.mock.calls[0][0](navigationState) as AppState
    expect(next.draft?.values.issue).toBe('A')

    setState.mockClear()
    const toggleState: AppState = {
      route: 'wizard',
      activeTaskId: 'change-review',
      selectedIndex: 2,
      draft: {
        taskId: 'change-review',
        values: {
          mode: 'local',
          all: false,
        },
        showAdvanced: true,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([toggleState, setState])
    App({ cwd: '/repo' })

    capturedInput?.(' ', {})
    next = setState.mock.calls[0][0](toggleState) as AppState
    expect(next.draft?.values.all).toBe(true)

    setState.mockClear()
    const selectState: AppState = {
      route: 'wizard',
      activeTaskId: 'change-review',
      selectedIndex: 0,
      draft: {
        taskId: 'change-review',
        values: {
          mode: 'branch',
        },
        showAdvanced: false,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([selectState, setState])
    App({ cwd: '/repo' })

    capturedInput?.('', { leftArrow: true })
    next = setState.mock.calls[0][0](selectState) as AppState
    expect(next.draft?.values.mode).toBe('local')
  })

  it('starts runs from preview and closes completed runs', async () => {
    const setState = vi.fn()
    const command: BuiltCommand = {
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    }
    const state: AppState = {
      route: 'preview',
      selectedIndex: 0,
      command,
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])
    run.mockImplementation((_command: BuiltCommand, _options: Record<string, unknown>, handlers?: { onUpdate?: (run: RunState) => void }) => {
      handlers?.onUpdate?.({
        command,
        display: command.display,
        logs: ['done\n'],
        status: 'completed',
        exitCode: 0,
        artifacts: {},
      })
    })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })
    const runningState = setState.mock.calls[0][0](state) as AppState
    expect(runningState.route).toBe('run')
    expect(createRunController).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)

    setState.mockClear()
    const runState: AppState = {
      route: 'run',
      selectedIndex: 0,
      command,
      run: {
        command,
        display: command.display,
        logs: [],
        status: 'completed',
        exitCode: 0,
        artifacts: {},
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([runState, setState])
    App({ cwd: '/repo' })

    capturedInput?.('', { escape: true })
    const closed = setState.mock.calls[0][0](runState) as AppState
    expect(closed.route).toBe('dashboard')
  })

  it('returns from preview on escape and keeps running sessions from quitting', async () => {
    const setState = vi.fn()
    const command: BuiltCommand = {
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    }
    const previewState: AppState = {
      route: 'preview',
      selectedIndex: 0,
      command,
      draft: {
        taskId: 'issue-fix',
        values: {
          issue: 'Fix dashboard crash',
        },
        showAdvanced: false,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([previewState, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { escape: true })
    const next = setState.mock.calls[0][0](previewState) as AppState
    expect(next.route).toBe('wizard')

    setState.mockClear()
    const activeRunState: AppState = {
      route: 'run',
      selectedIndex: 0,
      command,
      run: {
        command,
        display: command.display,
        logs: [],
        status: 'running',
        artifacts: {},
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([activeRunState, setState])
    App({ cwd: '/repo' })

    capturedInput?.('q', {})
    expect(exit).not.toHaveBeenCalled()
  })

  it('renders the graph workbench route when graph session state is active', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'overview',
        selectedActionIndex: 0,
        data: {
          graph: {
            sessionId: 'harness-graph-1',
            graphId: 'checkout-v2',
            title: 'Checkout V2',
            status: 'active',
            rollup: {
              ready: 0,
              waitingApproval: 1,
              blocked: 1,
            },
          },
          nodes: [],
          actions: [],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    const element = App({ cwd: '/repo' }) as { type: { name?: string } }

    expect(element.type.name).toBe('GraphWorkbench')
  })

  it('runs selected graph workbench actions without leaving the workbench', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'actions',
        selectedActionIndex: 0,
        data: {
          graph: {
            sessionId: 'harness-graph-1',
            graphId: 'checkout-v2',
            title: 'Checkout V2',
            status: 'active',
            rollup: {
              ready: 0,
              waitingApproval: 1,
              blocked: 1,
            },
          },
          nodes: [],
          actions: [
            {
              id: 'approve:release',
              kind: 'approve',
              label: 'Approve release',
              description: 'Approve pending gate for release-approval.',
              command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })

    expect(createRunController).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(
      {
        argv: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
        display: 'magpie harness approve harness-graph-1 --node release-approval --gate approve-release',
        summary: 'Approve pending gate for release-approval.',
      },
      expect.objectContaining({
        cwd: '/repo',
      }),
      expect.any(Object)
    )
  })

  it('refreshes graph workbench data after a successful direct action', async () => {
    const setState = vi.fn()
    loadGraphWorkbench.mockResolvedValue({
      graph: {
        sessionId: 'harness-graph-1',
        graphId: 'checkout-v2',
        title: 'Checkout V2',
        status: 'active',
        rollup: {
          total: 2,
          ready: 1,
          running: 0,
          waitingApproval: 0,
          waitingRetry: 0,
          blocked: 0,
          completed: 1,
          failed: 0,
        },
      },
      nodes: [
        {
          id: 'release-approval',
          title: 'Release approval',
          type: 'approval',
          state: 'completed',
          approvalPending: false,
        },
      ],
      selectedNodeId: 'release-approval',
      actions: [],
      attention: [],
      events: [],
    })
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'actions',
        selectedNodeId: 'release-approval',
        selectedActionIndex: 0,
        data: {
          graph: {
            sessionId: 'harness-graph-1',
            graphId: 'checkout-v2',
            title: 'Checkout V2',
            status: 'active',
            rollup: {
              total: 2,
              ready: 0,
              running: 0,
              waitingApproval: 1,
              waitingRetry: 0,
              blocked: 1,
              completed: 0,
              failed: 0,
            },
          },
          nodes: [
            {
              id: 'release-approval',
              title: 'Release approval',
              type: 'approval',
              state: 'waiting_approval',
              approvalPending: true,
            },
          ],
          selectedNodeId: 'release-approval',
          actions: [
            {
              id: 'approve:release',
              kind: 'approve',
              label: 'Approve release',
              description: 'Approve pending gate for release-approval.',
              command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])
    run.mockImplementation((command: BuiltCommand, _options: Record<string, unknown>, handlers?: { onUpdate?: (run: RunState) => void }) => {
      handlers?.onUpdate?.({
        command,
        display: command.display,
        logs: ['done\n'],
        status: 'completed',
        exitCode: 0,
        artifacts: {},
      })
    })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })
    await flushPromises()

    const completedMessage = setState.mock.calls
      .map((call) => call[0](state) as AppState)
      .find((next) => next.graphWorkbench?.message === 'Approve release completed.')

    expect(completedMessage?.graphWorkbench?.message).toBe('Approve release completed.')
    expect(loadGraphWorkbench).toHaveBeenCalledWith({
      cwd: '/repo',
      sessionId: 'harness-graph-1',
      selectedNodeId: 'release-approval',
    })

    const refreshedState = setState.mock.calls
      .map((call) => call[0](state) as AppState)
      .find((next) => next.graphWorkbench?.data?.selectedNodeId === 'release-approval')

    expect(refreshedState?.graphWorkbench?.selectedNodeId).toBe('release-approval')
    expect(refreshedState?.graphWorkbench?.focusedPanel).toBe('actions')
  })

  it('shows a loading state and requests graph workbench data when route is opened without cached data', async () => {
    const setState = vi.fn()
    mockUseEffect.mockImplementation((effect: () => void | (() => void)) => {
      effect()
    })
    loadGraphWorkbench.mockResolvedValue({
      graph: {
        sessionId: 'harness-graph-1',
        graphId: 'checkout-v2',
        title: 'Checkout V2',
        status: 'active',
        rollup: {
          total: 2,
          ready: 0,
          running: 0,
          waitingApproval: 1,
          waitingRetry: 0,
          blocked: 1,
          completed: 0,
          failed: 0,
        },
      },
      nodes: [],
      actions: [],
      attention: [],
      events: [],
    })
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'overview',
        selectedActionIndex: 0,
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    const element = App({ cwd: '/repo' }) as { props: Record<string, unknown> }
    await flushPromises()

    expect(element.props.children).toBe('Loading graph workbench...')
    expect(loadGraphWorkbench).toHaveBeenCalledWith({
      cwd: '/repo',
      sessionId: 'harness-graph-1',
      selectedNodeId: undefined,
    })
    expect(setState).toHaveBeenCalled()
  })

  it('marks graph workbench actions as failed when the command exits non-zero', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'actions',
        selectedActionIndex: 0,
        data: {
          graph: {
            sessionId: 'harness-graph-1',
            graphId: 'checkout-v2',
            title: 'Checkout V2',
            status: 'active',
            rollup: {
              total: 2,
              ready: 0,
              running: 0,
              waitingApproval: 1,
              waitingRetry: 0,
              blocked: 1,
              completed: 0,
              failed: 0,
            },
          },
          nodes: [],
          actions: [
            {
              id: 'approve:release',
              kind: 'approve',
              label: 'Approve release',
              description: 'Approve pending gate for release-approval.',
              command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])
    run.mockImplementation((_command: BuiltCommand, _options: Record<string, unknown>, handlers?: { onUpdate?: (run: RunState) => void }) => {
      handlers?.onUpdate?.({
        command: _command,
        display: _command.display,
        logs: ['failed\n'],
        status: 'failed',
        exitCode: 1,
        artifacts: {},
      })
    })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })

    const messageUpdate = setState.mock.calls
      .map((call) => call[0](state) as AppState)
      .find((next) => next.graphWorkbench?.message === 'Approve release failed.')

    expect(messageUpdate?.graphWorkbench?.message).toBe('Approve release failed.')
  })

  it('marks reject actions as failed with the matching action label', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        focusedPanel: 'actions',
        selectedActionIndex: 0,
        data: {
          graph: {
            sessionId: 'harness-graph-1',
            graphId: 'checkout-v2',
            title: 'Checkout V2',
            status: 'active',
            rollup: {
              total: 2,
              ready: 0,
              running: 0,
              waitingApproval: 1,
              waitingRetry: 0,
              blocked: 1,
              completed: 0,
              failed: 0,
            },
          },
          nodes: [],
          actions: [
            {
              id: 'reject:release',
              kind: 'reject',
              label: 'Reject release',
              description: 'Reject pending gate for release-approval.',
              command: ['harness', 'reject', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])
    run.mockImplementation((_command: BuiltCommand, _options: Record<string, unknown>, handlers?: { onUpdate?: (run: RunState) => void }) => {
      handlers?.onUpdate?.({
        command: _command,
        display: _command.display,
        logs: ['failed\n'],
        status: 'failed',
        exitCode: 1,
        artifacts: {},
      })
    })

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('', { return: true })

    const messageUpdate = setState.mock.calls
      .map((call) => call[0](state) as AppState)
      .find((next) => next.graphWorkbench?.message === 'Reject release failed.')

    expect(messageUpdate?.graphWorkbench?.message).toBe('Reject release failed.')
  })

  it('exits immediately on Ctrl+C', async () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 0,
      sessions: { continue: [], recent: [] },
    }
    mockUseState.mockReturnValue([state, setState])

    const { App } = await import('../../src/tui/app.js')
    App({ cwd: '/repo' })

    capturedInput?.('c', { ctrl: true })

    expect(exit).toHaveBeenCalledTimes(1)
  })
})

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
})

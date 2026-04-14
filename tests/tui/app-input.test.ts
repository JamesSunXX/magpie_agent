import { describe, expect, it, vi } from 'vitest'
import { handleDashboardInput, handleGraphWorkbenchInput, handlePreviewInput, handleRunInput } from '../../src/tui/app-input.js'
import type { AppState } from '../../src/tui/types.js'

describe('app input', () => {
  it('refreshes dashboard data when r is pressed', async () => {
    const setState = vi.fn()
    const refreshDashboard = vi.fn().mockResolvedValue(undefined)
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 0,
      sessions: { continue: [], recent: [] },
    }

    const handled = handleDashboardInput({
      input: 'r',
      key: {},
      state,
      refreshDashboard,
      setState,
    })

    expect(handled).toBe(true)
    expect(refreshDashboard).toHaveBeenCalledTimes(1)
    expect(setState).not.toHaveBeenCalled()
  })

  it('opens a task wizard from the dashboard', () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 0,
      sessions: { continue: [], recent: [] },
    }

    const handled = handleDashboardInput({
      input: '',
      key: { return: true },
      state,
      refreshDashboard: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    const next = setState.mock.calls[0][0](state) as AppState
    expect(next.route).toBe('wizard')
  })

  it('opens graph workbench for graph-backed harness sessions', () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'dashboard',
      selectedIndex: 5,
      sessions: {
        continue: [
          {
            id: 'harness-graph-1',
            capability: 'harness',
            title: 'Checkout graph',
            status: 'blocked',
            updatedAt: new Date('2026-03-19T12:00:00.000Z'),
            graphPath: '/tmp/harness-graph-1/graph.json',
            resumeCommand: ['harness', 'resume', 'harness-graph-1'],
            artifactPaths: ['/tmp/harness-graph-1/graph.json'],
          },
        ],
        recent: [],
      },
    }

    const handled = handleDashboardInput({
      input: '',
      key: { return: true },
      state,
      refreshDashboard: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    const next = setState.mock.calls[0][0](state) as AppState
    expect(next.route).toBe('graph-workbench')
    expect(next.graphWorkbench?.sessionId).toBe('harness-graph-1')
    expect(next.graphWorkbench?.selectedNodeId).toBeUndefined()
  })

  it('navigates graph workbench panels and returns to the dashboard on escape', () => {
    const setState = vi.fn()
    const state: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        selectedNodeId: 'design-api',
        focusedPanel: 'overview',
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
              id: 'design-api',
              title: 'Design API',
              type: 'feature',
              state: 'completed',
              approvalPending: false,
            },
            {
              id: 'release-approval',
              title: 'Release approval',
              type: 'approval',
              state: 'waiting_approval',
              approvalPending: true,
            },
          ],
          selectedNodeId: 'design-api',
          selectedNode: {
            id: 'design-api',
            title: 'Design API',
            type: 'feature',
            state: 'completed',
            dependencies: [],
            approvalPending: false,
            unresolvedIssues: [],
          },
          actions: [
            {
              id: 'approve:release',
              kind: 'approve',
              label: 'Approve release',
              description: 'Approve pending gate for release-approval.',
              command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
            {
              id: 'jump:loop',
              kind: 'jump',
              label: 'Open linked loop session',
              description: 'Resume linked loop session loop-ship.',
              command: ['loop', 'resume', 'loop-ship'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }

    let handled = handleGraphWorkbenchInput({
      input: '',
      key: { downArrow: true },
      state,
      refreshWorkbench: vi.fn(),
      openCommandPreview: vi.fn(),
      runWorkbenchAction: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    let next = setState.mock.calls[0][0](state) as AppState
    expect(next.graphWorkbench?.selectedNodeId).toBe('release-approval')

    setState.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { rightArrow: true },
      state,
      refreshWorkbench: vi.fn(),
      openCommandPreview: vi.fn(),
      runWorkbenchAction: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    next = setState.mock.calls[0][0](state) as AppState
    expect(next.graphWorkbench?.focusedPanel).toBe('actions')

    const actionsState: AppState = {
      ...state,
      graphWorkbench: {
        ...state.graphWorkbench!,
        focusedPanel: 'actions',
      },
    }

    setState.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { downArrow: true },
      state: actionsState,
      refreshWorkbench: vi.fn(),
      openCommandPreview: vi.fn(),
      runWorkbenchAction: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    next = setState.mock.calls[0][0](actionsState) as AppState
    expect(next.graphWorkbench?.selectedActionIndex).toBe(1)

    setState.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { escape: true },
      state: actionsState,
      refreshWorkbench: vi.fn(),
      openCommandPreview: vi.fn(),
      runWorkbenchAction: vi.fn(),
      setState,
    })

    expect(handled).toBe(true)
    next = setState.mock.calls[0][0](actionsState) as AppState
    expect(next.route).toBe('dashboard')
    expect(next.graphWorkbench).toBeUndefined()
  })

  it('runs direct actions and requires confirmation before rejection', () => {
    const setState = vi.fn()
    const openCommandPreview = vi.fn()
    const runWorkbenchAction = vi.fn()
    const baseState: AppState = {
      route: 'graph-workbench',
      selectedIndex: 0,
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        selectedNodeId: 'release-approval',
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
          selectedNodeId: 'release-approval',
          selectedNode: {
            id: 'release-approval',
            title: 'Release approval',
            type: 'approval',
            state: 'waiting_approval',
            dependencies: [],
            approvalPending: true,
            reviewerSummaries: [],
            unresolvedIssues: [],
          },
          actions: [
            {
              id: 'approve:release',
              kind: 'approve',
              label: 'Approve release',
              description: 'Approve pending gate for release-approval.',
              command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: false,
            },
            {
              id: 'reject:release',
              kind: 'reject',
              label: 'Reject release',
              description: 'Reject pending gate for release-approval.',
              command: ['harness', 'reject', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
              requiresConfirmation: true,
            },
            {
              id: 'jump:loop',
              kind: 'jump',
              label: 'Open linked loop session',
              description: 'Resume linked loop session loop-ship.',
              command: ['loop', 'resume', 'loop-ship'],
              requiresConfirmation: false,
            },
          ],
          attention: [],
          events: [],
        },
      },
      sessions: { continue: [], recent: [] },
    }

    let handled = handleGraphWorkbenchInput({
      input: '',
      key: { return: true },
      state: baseState,
      refreshWorkbench: vi.fn(),
      openCommandPreview,
      runWorkbenchAction,
      setState,
    })

    expect(handled).toBe(true)
    expect(runWorkbenchAction).toHaveBeenCalledWith(baseState.graphWorkbench?.data?.actions[0])

    const rejectState: AppState = {
      ...baseState,
      graphWorkbench: {
        ...baseState.graphWorkbench!,
        selectedActionIndex: 1,
      },
    }

    setState.mockClear()
    runWorkbenchAction.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { return: true },
      state: rejectState,
      refreshWorkbench: vi.fn(),
      openCommandPreview,
      runWorkbenchAction,
      setState,
    })

    expect(handled).toBe(true)
    expect(runWorkbenchAction).not.toHaveBeenCalled()
    let next = setState.mock.calls[0][0](rejectState) as AppState
    expect(next.graphWorkbench?.pendingConfirmationActionId).toBe('reject:release')
    expect(next.graphWorkbench?.message).toBe('Press Enter again to confirm reject release.')

    setState.mockClear()
    const confirmedRejectState: AppState = {
      ...rejectState,
      graphWorkbench: {
        ...rejectState.graphWorkbench!,
        pendingConfirmationActionId: 'reject:release',
      },
    }
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { return: true },
      state: confirmedRejectState,
      refreshWorkbench: vi.fn(),
      openCommandPreview,
      runWorkbenchAction,
      setState,
    })

    expect(handled).toBe(true)
    expect(runWorkbenchAction).toHaveBeenCalledWith(confirmedRejectState.graphWorkbench?.data?.actions[1])

    setState.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { downArrow: true },
      state: confirmedRejectState,
      refreshWorkbench: vi.fn(),
      openCommandPreview,
      runWorkbenchAction,
      setState,
    })

    expect(handled).toBe(true)
    next = setState.mock.calls[0][0](confirmedRejectState) as AppState
    expect(next.graphWorkbench?.selectedActionIndex).toBe(2)
    expect(next.graphWorkbench?.pendingConfirmationActionId).toBeUndefined()

    const jumpState: AppState = {
      ...baseState,
      graphWorkbench: {
        ...baseState.graphWorkbench!,
        selectedActionIndex: 2,
      },
    }

    openCommandPreview.mockClear()
    handled = handleGraphWorkbenchInput({
      input: '',
      key: { return: true },
      state: jumpState,
      refreshWorkbench: vi.fn(),
      openCommandPreview,
      runWorkbenchAction,
      setState,
    })

    expect(handled).toBe(true)
    expect(openCommandPreview).toHaveBeenCalledWith({
      argv: ['loop', 'resume', 'loop-ship'],
      display: 'magpie loop resume loop-ship',
      summary: 'Resume linked loop session loop-ship.',
    })
  })

  it('returns preview and completed runs to graph workbench when graph context exists', () => {
    const setState = vi.fn()
    const previewState: AppState = {
      route: 'preview',
      selectedIndex: 0,
      command: {
        argv: ['loop', 'resume', 'loop-ship'],
        display: 'magpie loop resume loop-ship',
        summary: 'Resume linked loop session loop-ship.',
      },
      graphWorkbench: {
        sessionId: 'harness-graph-1',
        selectedNodeId: 'release-approval',
        focusedPanel: 'actions',
        selectedActionIndex: 2,
      },
      sessions: { continue: [], recent: [] },
    }

    let handled = handlePreviewInput({
      key: { escape: true },
      state: previewState,
      setState,
      startRun: vi.fn(),
    })

    expect(handled).toBe(true)
    let next = setState.mock.calls[0][0](previewState) as AppState
    expect(next.route).toBe('graph-workbench')
    expect(next.graphWorkbench?.selectedNodeId).toBe('release-approval')

    setState.mockClear()
    const runState: AppState = {
      route: 'run',
      selectedIndex: 0,
      command: previewState.command,
      run: {
        command: previewState.command!,
        display: previewState.command!.display,
        logs: [],
        status: 'completed',
        exitCode: 0,
        artifacts: {},
      },
      graphWorkbench: previewState.graphWorkbench,
      sessions: { continue: [], recent: [] },
    }

    handled = handleRunInput({
      key: { escape: true },
      state: runState,
      setState,
    })

    expect(handled).toBe(true)
    next = setState.mock.calls[0][0](runState) as AppState
    expect(next.route).toBe('graph-workbench')
    expect(next.graphWorkbench?.focusedPanel).toBe('actions')
  })
})

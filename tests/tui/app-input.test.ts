import { describe, expect, it, vi } from 'vitest'
import { handleDashboardInput } from '../../src/tui/app-input.js'
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
})

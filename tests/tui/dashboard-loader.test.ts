import { describe, expect, it, vi } from 'vitest'
import { refreshDashboardData } from '../../src/tui/dashboard-loader.js'

describe('dashboard loader', () => {
  it('loads sessions and environment health together', async () => {
    const loadSessions = vi.fn().mockResolvedValue({
      continue: [],
      recent: [],
    })
    const inspectHealth = vi.fn().mockResolvedValue({
      items: [],
    })

    const result = await refreshDashboardData(
      {
        cwd: '/repo',
        configPath: '/tmp/config.yaml',
      },
      {
        loadSessions,
        inspectHealth,
      }
    )

    expect(loadSessions).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(inspectHealth).toHaveBeenCalledWith({
      cwd: '/repo',
      configPath: '/tmp/config.yaml',
    })
    expect(result).toEqual({
      sessions: { continue: [], recent: [] },
      health: { items: [] },
    })
  })
})

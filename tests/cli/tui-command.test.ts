import { beforeEach, describe, expect, it, vi } from 'vitest'

const startTuiApp = vi.fn()

vi.mock('../../src/tui/index.js', () => ({
  startTuiApp,
}))

describe('tui command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts the TUI app with the current cwd and config path', async () => {
    const { tuiCommand } = await import('../../src/cli/commands/tui.js')

    await tuiCommand.parseAsync(['node', 'tui', '--config', '/tmp/magpie.yaml'], { from: 'node' })

    expect(startTuiApp).toHaveBeenCalledWith({
      cwd: process.cwd(),
      configPath: '/tmp/magpie.yaml',
    })
  })
})

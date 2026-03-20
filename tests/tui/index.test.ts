import { beforeEach, describe, expect, it, vi } from 'vitest'

const render = vi.fn()
const MockApp = vi.fn()

vi.mock('ink', () => ({
  render,
}))

vi.mock('../../src/tui/app.js', () => ({
  App: MockApp,
}))

describe('TUI bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the app root with the provided props', async () => {
    render.mockReturnValue({ waitUntilExit: async () => undefined })
    const { startTuiApp } = await import('../../src/tui/index.js')

    await startTuiApp({ cwd: '/repo', configPath: '/tmp/config.yaml' })

    expect(render).toHaveBeenCalledTimes(1)
    const element = render.mock.calls[0][0] as { type: unknown; props: Record<string, unknown> }
    expect(element.type).toBe(MockApp)
    expect(element.props).toMatchObject({
      cwd: '/repo',
      configPath: '/tmp/config.yaml',
    })
  })
})

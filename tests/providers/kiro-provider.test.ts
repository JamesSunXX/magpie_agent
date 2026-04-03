import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExistsSync, mockEnsureKiroInstall, mockResolveInstalledKiroAgent } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockEnsureKiroInstall: vi.fn(),
  mockResolveInstalledKiroAgent: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}))

vi.mock('../../src/providers/kiro-install.js', () => ({
  ensureKiroInstall: mockEnsureKiroInstall,
  resolveInstalledKiroAgent: mockResolveInstalledKiroAgent,
}))

import { KiroProvider } from '../../src/providers/kiro.js'

describe('KiroProvider agent resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses project-managed kiro-config when available', async () => {
    mockExistsSync.mockReturnValue(true)
    mockEnsureKiroInstall.mockReturnValue({
      selectedAgent: 'architect',
      installed: false,
    })

    const provider = new KiroProvider({
      apiKey: '',
      model: 'kiro',
      logicalName: 'reviewers.kiro:architect',
      agent: 'architect',
    })
    provider.setCwd('/repo')

    await expect(provider.resolveAgent()).resolves.toBe('architect')
    expect(mockEnsureKiroInstall).toHaveBeenCalledWith({
      sourceDir: '/repo/agents/kiro-config',
      desiredAgent: 'architect',
    })
    expect(mockResolveInstalledKiroAgent).not.toHaveBeenCalled()
  })

  it('falls back to installed kiro agents when the project has no managed source', async () => {
    mockExistsSync.mockReturnValue(false)
    mockResolveInstalledKiroAgent.mockReturnValue('architect')

    const provider = new KiroProvider({
      apiKey: '',
      model: 'kiro',
      logicalName: 'reviewers.kiro:architect',
      agent: 'architect',
    })
    provider.setCwd('/repo')

    await expect(provider.resolveAgent()).resolves.toBe('architect')
    expect(mockEnsureKiroInstall).not.toHaveBeenCalled()
    expect(mockResolveInstalledKiroAgent).toHaveBeenCalledWith({
      cwd: '/repo',
      desiredAgent: 'architect',
    })
  })
})

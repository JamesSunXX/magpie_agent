import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscussSession } from '../../../src/state/types.js'
import type { MagpieConfigV2 } from '../../../src/platform/config/types.js'
import type { AIProvider } from '../../../src/providers/types.js'
import {
  buildDiscussPlanReportPrompt,
  exportDiscussSession,
  validateDiscussExportOptions,
} from '../../../src/capabilities/discuss/application/export.js'
import { loadConfig } from '../../../src/platform/config/loader.js'
import { createProvider } from '../../../src/platform/providers/index.js'
import { StateManager } from '../../../src/core/state/index.js'
import { formatDiscussConclusion, formatDiscussMarkdown } from '../../../src/capabilities/discuss/runtime/flow.js'

const {
  writeFileSync,
  initDiscussions,
  listDiscussSessions,
  setCwd,
  chat,
} = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  initDiscussions: vi.fn(),
  listDiscussSessions: vi.fn(),
  setCwd: vi.fn(),
  chat: vi.fn(),
}))

vi.mock('fs', () => ({
  writeFileSync,
}))

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../../src/platform/providers/index.js', () => ({
  createProvider: vi.fn(),
}))

vi.mock('../../../src/capabilities/discuss/runtime/flow.js', () => ({
  formatDiscussConclusion: vi.fn(() => '# Conclusion Export'),
  formatDiscussMarkdown: vi.fn(() => '# Discussion Export'),
}))

vi.mock('../../../src/core/state/index.js', () => ({
  StateManager: vi.fn().mockImplementation(function StateManagerMock() {
    return {
      initDiscussions,
      listDiscussSessions,
    }
  }),
}))

const session: DiscussSession = {
  id: 'disc-1234',
  title: 'Should discuss become plan aware?',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T01:00:00.000Z'),
  status: 'completed',
  reviewerIds: ['claude', 'gpt'],
  rounds: [
    {
      roundNumber: 1,
      topic: 'Should discuss export a plan report?',
      analysis: 'Need an artifact that can be executed, not only debated.',
      messages: [
        {
          reviewerId: 'claude',
          content: 'Plan output should preserve risks and ordering.',
          timestamp: new Date('2026-04-01T00:10:00.000Z'),
        },
        {
          reviewerId: 'gpt',
          content: 'The export flow is the safest place to add this.',
          timestamp: new Date('2026-04-01T00:12:00.000Z'),
        },
      ],
      summaries: [
        {
          reviewerId: 'claude',
          summary: 'Prefer a dedicated plan report export.',
        },
      ],
      conclusion: 'Use a separate plan report export that creates an actionable markdown plan.',
      tokenUsage: [],
      timestamp: new Date('2026-04-01T00:20:00.000Z'),
    },
  ],
}

describe('discuss export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0

    listDiscussSessions.mockResolvedValue([session])
    chat.mockResolvedValue('# Plan Report\n\n## Background\n\n...')
    vi.mocked(createProvider).mockReturnValue({
      name: 'mock',
      chat,
      chatStream: vi.fn(),
      setCwd,
    } as unknown as AIProvider)
    vi.mocked(loadConfig).mockReturnValue({
      providers: {},
      defaults: {},
      reviewers: {},
      summarizer: {
        model: 'mock',
        prompt: 'summarize',
      },
      analyzer: {
        model: 'mock',
        prompt: 'analyze',
      },
      capabilities: {},
      integrations: {},
    } as MagpieConfigV2)
  })

  it('rejects plan report mode without export id', () => {
    expect(validateDiscussExportOptions({
      planReport: true,
    })).toBe('--plan-report requires --export <id>')
  })

  it('rejects json plan report exports', () => {
    expect(validateDiscussExportOptions({
      export: 'disc-1234',
      planReport: true,
      format: 'json',
    })).toBe('--plan-report currently supports markdown output only')
  })

  it('rejects conclusion-only plan report exports', () => {
    expect(validateDiscussExportOptions({
      export: 'disc-1234',
      planReport: true,
      conclusion: true,
    })).toBe('--plan-report cannot be combined with --conclusion')
  })

  it('builds a plan prompt from the full discussion session', () => {
    const prompt = buildDiscussPlanReportPrompt(session)

    expect(prompt).toContain('Background and Final Judgment')
    expect(prompt).toContain('Execution Steps')
    expect(prompt).toContain('Should discuss export a plan report?')
    expect(prompt).toContain('Need an artifact that can be executed, not only debated.')
    expect(prompt).toContain('Plan output should preserve risks and ordering.')
    expect(prompt).toContain('Use a separate plan report export that creates an actionable markdown plan.')
  })

  it('generates and writes a markdown plan report', async () => {
    const result = await exportDiscussSession({
      options: {
        export: 'disc-1234',
        planReport: true,
      },
      cwd: '/repo',
    })

    expect(StateManager).toHaveBeenCalledWith('/repo')
    expect(initDiscussions).toHaveBeenCalled()
    expect(vi.mocked(loadConfig)).toHaveBeenCalledWith(undefined)
    expect(vi.mocked(createProvider)).toHaveBeenCalledWith('mock', expect.any(Object))
    expect(setCwd).toHaveBeenCalledWith('/repo')
    expect(chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Execution Steps'),
        }),
      ]),
      expect.stringContaining('same language as the discussion')
    )
    expect(writeFileSync).toHaveBeenCalledWith('discuss-plan-disc-1234.md', '# Plan Report\n\n## Background\n\n...', 'utf-8')
    expect(result).toEqual({
      kind: 'plan',
      outputFile: 'discuss-plan-disc-1234.md',
      sessionId: 'disc-1234',
    })
  })

  it('writes a standard markdown export without extra model calls', async () => {
    const result = await exportDiscussSession({
      options: {
        export: 'disc-1234',
      },
      cwd: '/repo',
    })

    expect(chat).not.toHaveBeenCalled()
    expect(formatDiscussMarkdown).toHaveBeenCalledWith(session)
    expect(writeFileSync).toHaveBeenCalledWith('discuss-disc-1234.md', '# Discussion Export', 'utf-8')
    expect(result.kind).toBe('discussion')
  })

  it('writes a conclusion-only export', async () => {
    await exportDiscussSession({
      options: {
        export: 'disc-1234',
        conclusion: true,
      },
      cwd: '/repo',
    })

    expect(formatDiscussConclusion).toHaveBeenCalledWith(session)
    expect(writeFileSync).toHaveBeenCalledWith('discuss-disc-1234.md', '# Conclusion Export', 'utf-8')
  })

  it('writes a json export of the session', async () => {
    await exportDiscussSession({
      options: {
        export: 'disc-1234',
        format: 'json',
      },
      cwd: '/repo',
    })

    expect(writeFileSync).toHaveBeenCalledWith(
      'discuss-disc-1234.md',
      JSON.stringify(session, null, 2),
      'utf-8'
    )
  })

  it('fails fast when export validation fails inside the export helper', async () => {
    await expect(exportDiscussSession({
      options: {
        planReport: true,
      },
      cwd: '/repo',
    })).rejects.toThrow('--plan-report requires --export <id>')
  })

  it('fails when no matching session exists', async () => {
    listDiscussSessions.mockResolvedValue([])

    await expect(exportDiscussSession({
      options: {
        export: 'missing',
      },
      cwd: '/repo',
    })).rejects.toThrow('No session found matching "missing"')
  })

  it('fails when multiple sessions match the requested export id', async () => {
    listDiscussSessions.mockResolvedValue([
      session,
      {
        ...session,
        id: 'disc-1234-extra',
        title: 'Another title',
      },
    ])

    await expect(exportDiscussSession({
      options: {
        export: 'disc-1234',
      },
      cwd: '/repo',
    })).rejects.toThrow('Multiple sessions match "disc-1234"')
  })
})

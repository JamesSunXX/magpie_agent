import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MagpieConfigV2 } from '../../../src/platform/config/types.js'

const createConfiguredProviderMock = vi.hoisted(() => vi.fn(() => ({ chat: vi.fn() })))
const stateManagerMethods = vi.hoisted(() => ({
  init: vi.fn(),
  initLoopSessions: vi.fn(),
  findIncompleteSessions: vi.fn(async () => []),
  loadFeatureAnalysis: vi.fn(async () => null),
  saveFeatureAnalysis: vi.fn(async () => undefined),
  saveSession: vi.fn(async () => undefined),
  loadSession: vi.fn(async () => null),
  saveReviewRoundCheckpoint: vi.fn(async () => undefined),
  listReviewRoundCheckpoints: vi.fn(async () => [
    {
      schemaVersion: 1,
      sessionId: 'session-1',
      roundNumber: 1,
      featureId: 'services',
      featureName: 'Services',
      status: 'completed',
      origin: 'live',
      focusAreas: ['security'],
      filePaths: ['services/app.py'],
      reviewerOutputs: [],
      result: {
        featureId: 'services',
        issues: [],
        summary: 'No issues',
        reviewedAt: new Date(),
      },
      completedAt: new Date(),
    },
  ]),
  getReviewStateDir: vi.fn((sessionId: string) => `/repo/.magpie/state/${sessionId}`),
}))
const scanFilesMock = vi.hoisted(() => vi.fn(async () => [
  { path: '/repo/services/app.py', relativePath: 'services/app.py', language: 'python', lines: 10, size: 40 },
]))
const getStatsMock = vi.hoisted(() => vi.fn(() => ({
  totalFiles: 1,
  totalLines: 10,
  languages: { python: 1 },
  estimatedTokens: 10,
  estimatedCost: 0.0001,
})))
const analyzeMock = vi.hoisted(() => vi.fn(async () => ({
  features: [{
    id: 'services',
    name: 'Services',
    description: 'service layer',
    entryPoints: ['services/app.py'],
    files: [{ path: '/repo/services/app.py', relativePath: 'services/app.py', language: 'python', lines: 10, size: 40 }],
    estimatedTokens: 10,
  }],
  uncategorized: [],
  analyzedAt: new Date(),
  codebaseHash: 'hash',
})))
const executeFeaturePlanMock = vi.hoisted(() => vi.fn(async () => ({
  repoName: 'repo',
  timestamp: new Date(),
  stats: { totalFiles: 1, totalLines: 10, languages: { python: 1 }, estimatedTokens: 10, estimatedCost: 0.0001 },
  architectureAnalysis: '',
  issues: [],
  tokenUsage: [],
  featureResults: {},
  finalConclusion: 'ok',
})))
const markdownGenerateMock = vi.hoisted(() => vi.fn(() => 'report'))

vi.mock('../../../src/platform/providers/index.js', () => ({
  createConfiguredProvider: createConfiguredProviderMock,
}))

vi.mock('../../../src/core/state/index.js', () => ({
  StateManager: vi.fn(function StateManagerMock() {
    return stateManagerMethods
  }),
}))

vi.mock('../../../src/core/repo/index.js', () => ({
  RepoScanner: vi.fn(function RepoScannerMock() {
    return {
      scanFiles: scanFilesMock,
      getStats: getStatsMock,
    }
  }),
}))

vi.mock('../../../src/feature-analyzer/index.js', () => ({
  FeatureAnalyzer: vi.fn(function FeatureAnalyzerMock() {
    return {
      analyze: analyzeMock,
    }
  }),
}))

vi.mock('../../../src/core/debate/repo-orchestrator.js', () => ({
  RepoOrchestrator: vi.fn(function RepoOrchestratorMock() {
    return {
      executeFeaturePlan: executeFeaturePlanMock,
    }
  }),
}))

vi.mock('../../../src/core/reporting/index.js', () => ({
  MarkdownReporter: vi.fn(function MarkdownReporterMock() {
    return {
      generate: markdownGenerateMock,
    }
  }),
}))

vi.mock('../../../src/feature-analyzer/hash.js', () => ({
  computeCodebaseHash: vi.fn(() => 'hash'),
}))

import { handleRepoReview } from '../../../src/capabilities/review/application/repo-review.js'

describe('handleRepoReview reviewer selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses configured review reviewer ids instead of all loaded reviewers for repo review', async () => {
    const config: MagpieConfigV2 = {
      providers: {},
      defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
      reviewers: {
        'kiro:go-reviewer': { model: 'kiro', agent: 'go-reviewer', prompt: 'review' },
        'route-gemini': { model: 'gemini-cli', prompt: 'route gemini' },
      },
      summarizer: { model: 'kiro', prompt: 'summarize' },
      analyzer: { model: 'kiro', prompt: 'analyze' },
      capabilities: {
        review: {
          enabled: true,
          reviewers: ['kiro:go-reviewer'],
        },
      },
      integrations: {
        notifications: { enabled: false },
      },
    } as MagpieConfigV2

    const spinner = {
      text: '',
      start: vi.fn().mockReturnThis(),
      stop: vi.fn(),
      succeed: vi.fn(),
    }

    await handleRepoReview({ deep: true }, config, spinner as never)

    const logicalNames = createConfiguredProviderMock.mock.calls
      .map(([binding]) => binding.logicalName)

    expect(logicalNames).toContain('reviewers.kiro:go-reviewer')
    expect(logicalNames).not.toContain('reviewers.route-gemini')
  })
})

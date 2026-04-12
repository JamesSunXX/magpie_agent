import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runTrdFlow } from '../../../src/capabilities/trd/runtime/flow.js'

const loadConfigMock = vi.hoisted(() => vi.fn())
const createConfiguredProviderMock = vi.hoisted(() => vi.fn())
const runDebateSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../../../src/platform/providers/index.js', () => ({
  createConfiguredProvider: createConfiguredProviderMock,
}))

vi.mock('../../../src/core/debate/runner.js', () => ({
  runDebateSession: runDebateSessionMock,
}))

describe('runTrdFlow constraints output', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('writes repo-local constraints output and stores its path in the TRD session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-trd-flow-'))
    const prdPath = join(dir, 'sample-prd.md')
    writeFileSync(prdPath, '# 结算约束\n\n- 禁止引入 Axios\n- 新增转换逻辑必须包含对应 .test.ts 文件\n', 'utf-8')

    loadConfigMock.mockReturnValue({
      providers: {},
      defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
      reviewers: {
        reviewerA: { model: 'mock', prompt: 'review' },
      },
      summarizer: { model: 'mock', prompt: 'summarize' },
      analyzer: { model: 'mock', prompt: 'analyze' },
      capabilities: {},
      integrations: {},
      trd: {
        default_reviewers: ['reviewerA'],
        domain: { require_human_confirmation: false },
      },
    })

    createConfiguredProviderMock.mockImplementation((input: { logicalName?: string }) => ({
      name: 'mock',
      chat: vi.fn(async () => {
        if (input.logicalName === 'analyzer') {
          return JSON.stringify({
            summary: '结算能力拆成一个领域。',
            principles: [],
            domains: [
              {
                id: 'domain-checkout',
                name: '结算',
                description: '结算领域',
                owner: 'checkout',
                inScope: ['支付计算'],
                outOfScope: [],
                upstreams: [],
                downstreams: [],
                contracts: [],
              },
            ],
            crossDomainFlows: [],
            risks: [],
          })
        }

        return JSON.stringify({
          trdMarkdown: '# 技术方案\n\n禁止引入 Axios。\n\n新增转换逻辑必须包含对应 .test.ts 文件。\n',
          openQuestions: [],
          traceability: [],
        })
      }),
      chatStream: vi.fn(async function * () {}),
    }))

    runDebateSessionMock.mockResolvedValue({
      finalConclusion: '## 结算领域\n\n负责支付计算与格式化转换。',
      analysis: 'ok',
    })

    const result = await runTrdFlow({
      prdPath,
      options: {
        autoAcceptDomains: true,
      },
      cwd: dir,
    })

    const constraintsPath = join(dir, '.magpie', 'constraints.json')
    const trdSessionsDir = join(dir, '.magpie', 'sessions', 'trd')
    const [sessionId] = readdirSync(trdSessionsDir)
    const sessionJson = readFileSync(join(trdSessionsDir, sessionId, 'session.json'), 'utf-8')

    const constraints = JSON.parse(readFileSync(constraintsPath, 'utf-8')) as {
      rules: Array<{ category: string; forbidden: string[]; expected: string[] }>
    }

    expect(result.exitCode).toBe(0)
    expect(existsSync(constraintsPath)).toBe(true)
    expect(constraints.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'dependency',
        forbidden: ['axios'],
      }),
      expect.objectContaining({
        category: 'test',
        expected: ['.test.ts'],
      }),
    ]))
    expect(existsSync(trdSessionsDir)).toBe(true)
    expect(sessionJson).toContain('"constraintsPath"')
  })
})

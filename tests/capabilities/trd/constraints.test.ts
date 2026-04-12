import { describe, expect, it } from 'vitest'
import {
  buildConstraintsArtifact,
  serializeConstraintsArtifact,
} from '../../../src/capabilities/trd/domain/constraints.js'

describe('TRD constraints artifact', () => {
  it('extracts supported rules from PRD and TRD text', () => {
    const artifact = buildConstraintsArtifact({
      sourcePrdPath: '/tmp/prd.md',
      sourceTrdPath: '/tmp/prd.trd.md',
      generatedAt: new Date('2026-04-12T00:00:00.000Z'),
      texts: [
        '约束：禁止引入 Axios；BFF 接口必须走 /api/v2/*；新增转换逻辑必须包含对应 .test.ts 文件。',
      ],
    })

    expect(artifact.version).toBe(1)
    expect(artifact.sourcePrdPath).toBe('/tmp/prd.md')
    expect(artifact.sourceTrdPath).toBe('/tmp/prd.trd.md')
    expect(artifact.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'dependency',
        forbidden: ['axios'],
        severity: 'error',
      }),
      expect.objectContaining({
        category: 'api',
        expected: ['/api/v2/*'],
      }),
      expect.objectContaining({
        category: 'test',
        expected: ['.test.ts'],
      }),
    ]))
  })

  it('serializes stable JSON with an empty rules array when nothing matches', () => {
    const artifact = buildConstraintsArtifact({
      sourcePrdPath: '/tmp/prd.md',
      sourceTrdPath: '/tmp/prd.trd.md',
      generatedAt: new Date('2026-04-12T00:00:00.000Z'),
      texts: ['这段文字不包含任何第一版支持的结构化约束。'],
    })

    const json = serializeConstraintsArtifact(artifact)
    const parsed = JSON.parse(json) as { rules: unknown[]; generatedAt: string }

    expect(parsed.rules).toEqual([])
    expect(parsed.generatedAt).toBe('2026-04-12T00:00:00.000Z')
  })
})

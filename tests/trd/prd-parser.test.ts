import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parsePrdMarkdown } from '../../src/trd/prd-parser.js'

describe('parsePrdMarkdown', () => {
  it('extracts title, requirements, sections and images', () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-trd-prd-'))
    try {
      const file = join(dir, 'prd.md')
      writeFileSync(file, `# 支付中心升级\n\n## 目标\n- 支持多渠道支付\n- 增加退款能力\n\n## UI\n![支付流程](./flow.png)\n`, 'utf-8')

      const parsed = parsePrdMarkdown(file)
      expect(parsed.title).toBe('支付中心升级')
      expect(parsed.requirements.length).toBeGreaterThanOrEqual(2)
      expect(parsed.requirements[0].id).toBe('REQ-001')
      expect(parsed.images).toHaveLength(1)
      expect(parsed.images[0].source).toBe('./flow.png')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})


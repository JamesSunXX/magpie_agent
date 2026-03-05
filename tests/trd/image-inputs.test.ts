import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { collectChatImages } from '../../src/trd/image-inputs.js'

describe('collectChatImages', () => {
  it('keeps remote URLs for multimodal input', () => {
    const result = collectChatImages(
      [
        { index: 1, alt: '流程', source: 'https://example.com/flow.png' },
      ],
      '/tmp/prd.md'
    )

    expect(result.images).toEqual([
      { source: 'https://example.com/flow.png', label: '流程' },
    ])
    expect(result.warnings).toEqual([])
  })

  it('keeps existing local files and warns on missing local files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-image-inputs-'))
    try {
      const prdPath = join(dir, 'prd.md')
      const existingImage = join(dir, 'ok.png')
      writeFileSync(prdPath, '# test\n', 'utf-8')
      writeFileSync(existingImage, 'png', 'utf-8')

      const result = collectChatImages(
        [
          { index: 1, alt: 'ok', source: './ok.png' },
          { index: 2, alt: 'missing', source: './missing.png' },
        ],
        prdPath
      )

      expect(result.images).toEqual([
        { source: existingImage, label: 'ok' },
      ])
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('./missing.png')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

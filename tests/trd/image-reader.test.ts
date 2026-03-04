import { describe, it, expect } from 'vitest'
import { enrichImagesWithOcr } from '../../src/trd/image-reader.js'

describe('enrichImagesWithOcr', () => {
  it('skips example images when skipExampleImages is enabled', async () => {
    const images = [
      { index: 1, alt: '示例图：流程展示', source: 'https://example.com/any.png' },
    ]

    const enriched = await enrichImagesWithOcr(images, '/tmp/prd.md', {
      enabled: true,
      command: 'non-existent-cmd {image}',
      timeoutMs: 1000,
      retries: 0,
      skipExampleImages: true,
      exampleKeywords: ['示例', 'example'],
    })

    expect(enriched[0].skipped).toBe(true)
    expect(enriched[0].skipReason).toBe('example-image')
    expect(enriched[0].error).toBeUndefined()
  })

  it('keeps OCR errors for non-example images', async () => {
    const images = [
      { index: 2, alt: '核心架构图', source: 'https://foo.invalid/any.png' },
    ]

    const enriched = await enrichImagesWithOcr(images, '/tmp/prd.md', {
      enabled: true,
      command: 'non-existent-cmd {image}',
      timeoutMs: 1000,
      retries: 0,
      skipExampleImages: true,
      exampleKeywords: ['示例', 'example'],
    })

    expect(enriched[0].skipped).not.toBe(true)
    expect(enriched[0].error).toBeDefined()
  })
})

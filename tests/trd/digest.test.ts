import { describe, expect, it } from 'vitest'
import { buildPrdDigestText } from '../../src/trd/digest.js'
import type { ParsedPrd } from '../../src/trd/types.js'

describe('buildPrdDigestText', () => {
  it('renders image source details without OCR wording', () => {
    const parsed: ParsedPrd = {
      path: '/tmp/prd.md',
      title: '测试 PRD',
      rawMarkdown: '# 测试',
      requirements: [
        { id: 'REQ-001', text: '支持创建订单', section: '目标' },
      ],
      sections: [
        { title: '目标', content: '- 支持创建订单' },
      ],
      images: [
        { index: 1, alt: '流程图', source: 'https://example.com/flow.png' },
        { index: 2, alt: '界面图', source: './assets/ui.png' },
      ],
    }

    const digest = buildPrdDigestText(parsed)

    expect(digest).toContain('## 图片信息')
    expect(digest).toContain('IMG-001 https://example.com/flow.png 来源: 远程链接')
    expect(digest).toContain('IMG-002 ./assets/ui.png 来源: 本地路径')
    expect(digest).not.toContain('OCR')
    expect(digest).not.toContain('OCR失败')
  })
})

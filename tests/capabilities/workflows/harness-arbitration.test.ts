import { describe, expect, it } from 'vitest'

import { resolveHarnessArbitrationOutcome } from '../../../src/capabilities/workflows/harness/application/arbitration.js'

describe('resolveHarnessArbitrationOutcome', () => {
  it('approves when the final conclusion uses narrative decision wording instead of raw JSON', () => {
    const outcome = resolveHarnessArbitrationOutcome({
      finalConclusion: `> 

## 讨论总结

### 共识点

两位评审在所有核心判断上完全一致。

### 最终裁定

决定：approved

结论：两位评审独立验证后一致批准，阻塞项已完整解决，建议合入。`,
      blockingIssueCount: 0,
      testsPassed: true,
    })

    expect(outcome.approved).toBe(true)
    expect(outcome.finalAction).toBe('approved')
    expect(outcome.nextRoundBrief).toBe('No further action.')
    expect(outcome.decision).toEqual({
      decision: 'approved',
      rationale: '两位评审独立验证后一致批准，阻塞项已完整解决，建议合入。',
    })
  })

  it('preserves narrative revise actions for the next fix cycle', () => {
    const outcome = resolveHarnessArbitrationOutcome({
      finalConclusion: `## 最终裁定

决定：revise

建议动作：
1. 修复失败测试
2. 重新运行检查`,
      blockingIssueCount: 1,
      testsPassed: false,
    })

    expect(outcome.approved).toBe(false)
    expect(outcome.finalAction).toBe('revise')
    expect(outcome.nextRoundBrief).toBe('修复失败测试; 重新运行检查')
    expect(outcome.shouldRequestIssueFix).toBe(true)
    expect(outcome.decision).toEqual({
      decision: 'revise',
      requiredActions: ['修复失败测试', '重新运行检查'],
    })
  })

  it('uses fallback texts when the final conclusion is only a prose summary', () => {
    const outcome = resolveHarnessArbitrationOutcome({
      finalConclusion: `## 讨论总结

两位评审在所有核心判断上完全一致。`,
      fallbackTexts: [
        '',
        '```json\n{"decision":"approved","rationale":"All checks passed.","requiredActions":[]}\n```',
      ],
      blockingIssueCount: 0,
      testsPassed: true,
    })

    expect(outcome.approved).toBe(true)
    expect(outcome.finalAction).toBe('approved')
    expect(outcome.decision).toEqual({
      decision: 'approved',
      rationale: 'All checks passed.',
      requiredActions: [],
    })
  })

  it('ignores unrelated JSON snippets in fallback text and keeps searching for a valid decision object', () => {
    const outcome = resolveHarnessArbitrationOutcome({
      finalConclusion: '## 讨论总结\n\n请参考附加材料。',
      fallbackTexts: [
        'Reading file completed.\n[1.1]',
        '```json\n[1.1]\n```',
        '```json\n{"decision":"revise","rationale":"Need a real staged-content verification.","requiredActions":["Verify staged content instead of the working tree."]}\n```',
      ],
      blockingIssueCount: 1,
      testsPassed: true,
    })

    expect(outcome.approved).toBe(false)
    expect(outcome.finalAction).toBe('revise')
    expect(outcome.nextRoundBrief).toBe('Verify staged content instead of the working tree.')
    expect(outcome.decision).toEqual({
      decision: 'revise',
      rationale: 'Need a real staged-content verification.',
      requiredActions: ['Verify staged content instead of the working tree.'],
    })
  })
})

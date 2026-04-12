import { describe, expect, it } from 'vitest'
import { classifyStructuredTestResult } from '../../../src/capabilities/loop/domain/test-execution.js'

describe('loop structured test execution', () => {
  it('classifies ordinary failed tests as quality failures', () => {
    const classified = classifyStructuredTestResult({
      command: 'npm run test:run',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:01.000Z',
      exitCode: 1,
      status: 'failed',
      output: 'FAIL formatAmount formats values correctly\nExpected "10.00" but received "10"',
      blocked: false,
    })

    expect(classified.failureKind).toBe('quality')
    expect(classified.failedTests).toContain('formatAmount formats values correctly')
  })

  it('classifies blocked or command-level failures as execution failures', () => {
    const classified = classifyStructuredTestResult({
      command: 'git reset --hard',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:01.000Z',
      exitCode: 1,
      status: 'failed',
      output: 'Dangerous command blocked: git reset --hard\nMatched rule: git reset --hard',
      blocked: true,
    })

    expect(classified.failureKind).toBe('execution')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildFailureSignature,
  classifyFailureCategory,
  normalizeFailureMessage,
} from '../../../src/core/failures/classifier.js'

describe('failure classifier', () => {
  it('classifies transient failures from timeout and rate limit signals', () => {
    expect(classifyFailureCategory({
      capability: 'harness-server',
      stage: 'reviewing',
      reason: 'Harness timed out while waiting for review cycle',
      rawError: 'spawnSync codex ETIMEDOUT',
      evidencePaths: [],
    })).toBe('transient')

    expect(classifyFailureCategory({
      capability: 'harness-server',
      stage: 'reviewing',
      reason: 'Harness execution failed',
      rawError: '429 rate limit exceeded',
      evidencePaths: [],
    })).toBe('transient')
  })

  it('classifies environment, quality, prompt_or_parse, workflow_defect, and unknown failures', () => {
    expect(classifyFailureCategory({
      capability: 'loop',
      stage: 'code_development',
      reason: 'Test command could not start',
      rawError: 'sh: codex: command not found',
      evidencePaths: [],
      metadata: { failureKind: 'execution' },
    })).toBe('environment')

    expect(classifyFailureCategory({
      capability: 'loop',
      stage: 'code_development',
      reason: 'Implementation still fails tests',
      rawError: 'FAIL formatAmount formats values correctly',
      evidencePaths: [],
      metadata: { failureKind: 'quality', failedTests: ['formatAmount formats values correctly'] },
    })).toBe('quality')

    expect(classifyFailureCategory({
      capability: 'harness',
      stage: 'reviewing',
      reason: 'Failed to parse adjudication result',
      rawError: 'Unexpected token } in JSON at position 12',
      evidencePaths: [],
    })).toBe('prompt_or_parse')

    expect(classifyFailureCategory({
      capability: 'loop',
      stage: 'code_development',
      reason: 'Cannot safely resume because no reliable checkpoint was recorded.',
      rawError: 'state mismatch while resuming',
      evidencePaths: [],
      metadata: { checkpointMissing: true },
    })).toBe('workflow_defect')

    expect(classifyFailureCategory({
      capability: 'harness',
      stage: 'reviewing',
      reason: 'Something odd happened',
      rawError: 'mysterious failure',
      evidencePaths: [],
    })).toBe('unknown')
  })

  it('normalizes volatile message content before building signatures', () => {
    const normalized = normalizeFailureMessage(
      'Error: /tmp/demo/project/.magpie/sessions/loop/loop-abc123/output.ts:42:7 failed at 2026-04-12T10:00:00.000Z'
    )

    expect(normalized).not.toContain('/tmp/demo/project')
    expect(normalized).not.toContain('2026-04-12T10:00:00.000Z')
    expect(normalized).not.toContain(':42:7')
    expect(normalized.length).toBeGreaterThan(0)

    const signature = buildFailureSignature({
      capability: 'loop',
      stage: 'code_development',
      category: 'environment',
      reason: 'Command failed',
      rawError: 'ENOENT: no such file or directory, open /tmp/demo/project/.magpie/sessions/loop/loop-abc123/session.json',
    })

    expect(signature).toContain('loop|code_development|environment|')
    expect(signature).not.toContain('/tmp/demo/project')
    expect(signature).not.toContain('loop-abc123')
  })
})

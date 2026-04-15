import { describe, expect, it } from 'vitest'
import { isExplicitCapabilityException } from '../../scripts/check-boundaries.mjs'

describe('check-boundaries', () => {
  it('allows only explicit workflow capability exemptions', () => {
    expect(isExplicitCapabilityException(
      'src/capabilities/workflows/harness/application/execute.ts',
      'src/capabilities/loop/index.ts'
    )).toBe(true)

    expect(isExplicitCapabilityException(
      'src/capabilities/workflows/issue-fix/application/execute.ts',
      'src/capabilities/routing/index.ts'
    )).toBe(true)

    expect(isExplicitCapabilityException(
      'src/capabilities/workflows/harness/application/execute.ts',
      'src/capabilities/trd/index.ts'
    )).toBe(false)
  })
})

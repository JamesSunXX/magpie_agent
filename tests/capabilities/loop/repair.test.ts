import { describe, expect, it } from 'vitest'
import { advanceRepairState } from '../../../src/capabilities/loop/domain/repair.js'

describe('loop repair state', () => {
  it('moves quality failures into revising before the threshold', () => {
    const next = advanceRepairState({
      failureKind: 'quality',
      repairAttemptCount: 0,
      executionRetryCount: 0,
    })

    expect(next.currentLoopState).toBe('revising')
    expect(next.repairAttemptCount).toBe(1)
    expect(next.blockedForHuman).toBe(false)
  })

  it('moves execution failures into retrying_execution before the threshold', () => {
    const next = advanceRepairState({
      failureKind: 'execution',
      repairAttemptCount: 0,
      executionRetryCount: 0,
    })

    expect(next.currentLoopState).toBe('retrying_execution')
    expect(next.executionRetryCount).toBe(1)
    expect(next.blockedForHuman).toBe(false)
  })

  it('blocks for human once quality attempts hit the threshold', () => {
    const next = advanceRepairState({
      failureKind: 'quality',
      repairAttemptCount: 2,
      executionRetryCount: 0,
    })

    expect(next.currentLoopState).toBe('blocked_for_human')
    expect(next.repairAttemptCount).toBe(3)
    expect(next.blockedForHuman).toBe(true)
  })
})

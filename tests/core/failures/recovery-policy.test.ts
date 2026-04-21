import { describe, expect, it } from 'vitest'
import { decideRecovery } from '../../../src/core/failures/recovery-policy.js'

describe('failure recovery policy', () => {
  it('maps first-pass categories to the expected recovery actions', () => {
    expect(decideRecovery({ category: 'transient', occurrenceCount: 1 })).toMatchObject({
      action: 'retry_with_backoff',
      retryable: true,
      candidateForSelfRepair: false,
    })
    expect(decideRecovery({ category: 'environment', occurrenceCount: 1 })).toMatchObject({
      action: 'run_diagnostics',
    })
    expect(decideRecovery({ category: 'quality', occurrenceCount: 1 })).toMatchObject({
      action: 'block_for_human',
    })
    expect(decideRecovery({ category: 'prompt_or_parse', occurrenceCount: 1 })).toMatchObject({
      action: 'block_for_human',
      candidateForSelfRepair: false,
    })
    expect(decideRecovery({ category: 'workflow_defect', occurrenceCount: 1 })).toMatchObject({
      action: 'spawn_self_repair_candidate',
      candidateForSelfRepair: true,
    })
    expect(decideRecovery({ category: 'permission_denied', occurrenceCount: 1 })).toMatchObject({
      action: 'block_for_human',
      retryable: false,
    })
    expect(decideRecovery({ category: 'failure_budget_exhausted', occurrenceCount: 1 })).toMatchObject({
      action: 'block_for_human',
      retryable: false,
    })
    expect(decideRecovery({ category: 'resource_limit', occurrenceCount: 1 })).toMatchObject({
      action: 'block_for_human',
      retryable: false,
    })
  })

  it('upgrades repeated prompt_or_parse failures into self-repair candidates', () => {
    expect(decideRecovery({ category: 'prompt_or_parse', occurrenceCount: 2 })).toMatchObject({
      action: 'spawn_self_repair_candidate',
      candidateForSelfRepair: true,
    })
  })
})

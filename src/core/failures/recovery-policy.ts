import type { FailureCategory, RecoveryDecision } from './types.js'

interface RecoveryInput {
  category: FailureCategory
  occurrenceCount: number
  retryableHint?: boolean
}

const DIAGNOSTIC_CHECKS = [
  'config_exists',
  'input_metadata_exists',
  'repo_paths_exist',
]

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  switch (input.category) {
    case 'transient':
      return {
        action: 'retry_with_backoff',
        retryable: true,
        candidateForSelfRepair: false,
        reason: 'Transient failures should wait briefly and retry.',
        diagnosticChecks: [],
      }
    case 'environment':
      return {
        action: 'run_diagnostics',
        retryable: false,
        candidateForSelfRepair: false,
        reason: 'Environment failures need minimal diagnostics before deciding whether to block.',
        diagnosticChecks: DIAGNOSTIC_CHECKS,
      }
    case 'quality':
      return {
        action: 'block_for_human',
        retryable: false,
        candidateForSelfRepair: false,
        reason: 'Quality failures need human or development follow-up.',
        diagnosticChecks: [],
      }
    case 'prompt_or_parse':
      return input.occurrenceCount >= 2
        ? {
          action: 'spawn_self_repair_candidate',
          retryable: false,
          candidateForSelfRepair: true,
          reason: 'Repeated prompt or parse failures should become self-repair candidates.',
          diagnosticChecks: [],
        }
        : {
          action: 'block_for_human',
          retryable: false,
          candidateForSelfRepair: false,
          reason: 'First prompt or parse failures should stop for review.',
          diagnosticChecks: [],
        }
    case 'workflow_defect':
      return {
        action: 'spawn_self_repair_candidate',
        retryable: false,
        candidateForSelfRepair: true,
        reason: 'Workflow defects should be elevated into self-repair candidates immediately.',
        diagnosticChecks: [],
      }
    case 'unknown':
    default:
      if (input.retryableHint) {
        return {
          action: 'retry_same_step',
          retryable: true,
          candidateForSelfRepair: false,
          reason: 'A retryable hint was provided for an otherwise unknown failure.',
          diagnosticChecks: [],
        }
      }
      return {
        action: 'block_for_human',
        retryable: false,
        candidateForSelfRepair: false,
        reason: 'Unknown failures should stop for inspection.',
        diagnosticChecks: [],
      }
  }
}

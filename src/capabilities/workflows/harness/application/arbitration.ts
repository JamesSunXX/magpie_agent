import { extractJsonBlock } from '../../../../trd/renderer.js'
import type { RoleFinalAction } from '../../../../core/roles/index.js'

export interface HarnessArbitrationDecision {
  decision?: 'approved' | 'revise'
  rationale?: string
  requiredActions?: string[]
}

export interface HarnessArbitrationOutcome {
  decision: HarnessArbitrationDecision | null
  approved: boolean
  finalAction: RoleFinalAction
  rationale: string
  nextRoundBrief: string
  shouldRequestIssueFix: boolean
}

const DEFAULT_REVISE_BRIEF = 'Address blocking review findings and rerun the checks.'
const DEFAULT_BLOCKED_BRIEF = 'Adjudication did not produce an actionable next step.'
const DEFAULT_RATIONALE = 'No parsable decision returned by discuss final conclusion.'

export function resolveHarnessArbitrationOutcome(params: {
  finalConclusion: string
  blockingIssueCount: number
  testsPassed: boolean
}): HarnessArbitrationOutcome {
  const decision = extractJsonBlock<HarnessArbitrationDecision>(params.finalConclusion)
  const approved = params.blockingIssueCount === 0
    && params.testsPassed
    && decision?.decision === 'approved'
  const finalAction: RoleFinalAction = approved
    ? 'approved'
    : decision?.decision === 'revise' || params.blockingIssueCount > 0 || !params.testsPassed
      ? 'revise'
      : 'requeue_or_blocked'
  const requiredActions = (decision?.requiredActions || []).filter(Boolean)
  const rationale = decision?.rationale || DEFAULT_RATIONALE
  const nextRoundBrief = approved
    ? 'No further action.'
    : finalAction === 'revise'
      ? requiredActions.join('; ') || DEFAULT_REVISE_BRIEF
      : requiredActions.join('; ') || decision?.rationale || DEFAULT_BLOCKED_BRIEF

  return {
    decision,
    approved,
    finalAction,
    rationale,
    nextRoundBrief,
    shouldRequestIssueFix: finalAction === 'revise',
  }
}

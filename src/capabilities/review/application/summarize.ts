import type { CapabilityContext } from '../../../core/capability/context.js'
import type { ReviewExecutionResult, ReviewSummaryOutput } from '../types.js'

export async function summarizeReview(
  result: ReviewExecutionResult,
  _ctx: CapabilityContext
): Promise<ReviewSummaryOutput> {
  return {
    summary: result.status === 'completed'
      ? 'Review capability execution completed.'
      : 'Review capability execution failed.',
    details: result.payload,
  }
}

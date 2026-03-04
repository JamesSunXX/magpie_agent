import type { CapabilityContext } from '../../../core/capability/context.js'
import type { ReviewSummaryOutput } from '../types.js'

export async function reportReviewSummary(output: ReviewSummaryOutput, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[review]', output.summary)
}

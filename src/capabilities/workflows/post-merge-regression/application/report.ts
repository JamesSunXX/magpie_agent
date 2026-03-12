import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { PostMergeRegressionSummary } from '../types.js'

export async function reportPostMergeRegression(
  output: PostMergeRegressionSummary,
  ctx: CapabilityContext
): Promise<void> {
  ctx.logger.debug('[post-merge-regression]', output.summary)
}

import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { PostMergeRegressionResult, PostMergeRegressionSummary } from '../types.js'

export async function summarizePostMergeRegression(
  result: PostMergeRegressionResult,
  _ctx: CapabilityContext
): Promise<PostMergeRegressionSummary> {
  return {
    summary: result.status === 'completed'
      ? 'Post-merge regression workflow completed.'
      : 'Post-merge regression workflow failed.',
    details: result.session,
  }
}

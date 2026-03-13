import type { CapabilityContext } from '../../../core/capability/context.js'
import { runReviewFlow } from '../runtime/flow.js'
import type { ReviewExecutionResult, ReviewPreparedInput } from '../types.js'

export async function executeReview(
  prepared: ReviewPreparedInput,
  ctx: CapabilityContext
): Promise<ReviewExecutionResult> {
  const payload = await runReviewFlow({
    target: prepared.target,
    options: (prepared.options || {}) as never,
    cwd: ctx.cwd,
  })

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

import type { CapabilityContext } from '../../../core/capability/context.js'
import type { ReviewExecutionResult, ReviewPreparedInput } from '../types.js'

interface ReviewExecutor {
  executeReview?: (input: ReviewPreparedInput, ctx: CapabilityContext) => Promise<unknown>
}

export async function executeReview(
  prepared: ReviewPreparedInput,
  ctx: CapabilityContext
): Promise<ReviewExecutionResult> {
  const hooks = (ctx.metadata || {}) as ReviewExecutor

  if (typeof hooks.executeReview === 'function') {
    const payload = await hooks.executeReview(prepared, ctx)
    return {
      status: 'completed',
      payload,
    }
  }

  return {
    status: 'delegated',
    payload: {
      message: 'Review execution is handled by legacy CLI command for compatibility.',
      target: prepared.target,
    },
  }
}

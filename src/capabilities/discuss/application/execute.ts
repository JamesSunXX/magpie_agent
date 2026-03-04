import type { CapabilityContext } from '../../../core/capability/context.js'
import type { DiscussExecutionResult, DiscussPreparedInput } from '../types.js'

interface DiscussExecutor {
  executeDiscuss?: (input: DiscussPreparedInput, ctx: CapabilityContext) => Promise<unknown>
}

export async function executeDiscuss(
  prepared: DiscussPreparedInput,
  ctx: CapabilityContext
): Promise<DiscussExecutionResult> {
  const hooks = (ctx.metadata || {}) as DiscussExecutor

  if (typeof hooks.executeDiscuss === 'function') {
    const payload = await hooks.executeDiscuss(prepared, ctx)
    return {
      status: 'completed',
      payload,
    }
  }

  return {
    status: 'delegated',
    payload: {
      message: 'Discuss execution is handled by legacy CLI command for compatibility.',
      topic: prepared.topic,
    },
  }
}

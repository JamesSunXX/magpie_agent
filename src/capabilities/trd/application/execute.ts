import type { CapabilityContext } from '../../../core/capability/context.js'
import type { TrdExecutionResult, TrdPreparedInput } from '../types.js'

interface TrdExecutor {
  executeTrd?: (input: TrdPreparedInput, ctx: CapabilityContext) => Promise<unknown>
}

export async function executeTrd(
  prepared: TrdPreparedInput,
  ctx: CapabilityContext
): Promise<TrdExecutionResult> {
  const hooks = (ctx.metadata || {}) as TrdExecutor

  if (typeof hooks.executeTrd === 'function') {
    const payload = await hooks.executeTrd(prepared, ctx)
    return {
      status: 'completed',
      payload,
    }
  }

  return {
    status: 'delegated',
    payload: {
      message: 'TRD execution is handled by legacy CLI command for compatibility.',
      prdPath: prepared.prdPath,
    },
  }
}

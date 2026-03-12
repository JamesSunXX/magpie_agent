import type { CapabilityContext } from '../../../core/capability/context.js'
import { runTrdFlow } from '../../../commands/trd.js'
import type { TrdExecutionResult, TrdPreparedInput } from '../types.js'

export async function executeTrd(
  prepared: TrdPreparedInput,
  ctx: CapabilityContext
): Promise<TrdExecutionResult> {
  const payload = await runTrdFlow({
    prdPath: prepared.prdPath,
    options: (prepared.options || {}) as never,
    cwd: ctx.cwd,
  })

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

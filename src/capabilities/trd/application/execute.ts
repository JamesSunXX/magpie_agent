import type { CapabilityContext } from '../../../core/capability/context.js'
import { serializeCliOptions } from '../../../core/capability/cli-options.js'
import { runCapabilitySubprocess } from '../../../core/capability/subprocess.js'
import type { TrdExecutionResult, TrdPreparedInput } from '../types.js'

export async function executeTrd(
  prepared: TrdPreparedInput,
  ctx: CapabilityContext
): Promise<TrdExecutionResult> {
  const payload = await runCapabilitySubprocess(
    'trd',
    [prepared.prdPath, ...serializeCliOptions(prepared.options)],
    ctx
  )

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

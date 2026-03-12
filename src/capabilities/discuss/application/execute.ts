import type { CapabilityContext } from '../../../core/capability/context.js'
import { serializeCliOptions } from '../../../core/capability/cli-options.js'
import { runCapabilitySubprocess } from '../../../core/capability/subprocess.js'
import type { DiscussExecutionResult, DiscussPreparedInput } from '../types.js'

export async function executeDiscuss(
  prepared: DiscussPreparedInput,
  ctx: CapabilityContext
): Promise<DiscussExecutionResult> {
  const payload = await runCapabilitySubprocess(
    'discuss',
    [prepared.topic, ...serializeCliOptions(prepared.options)],
    ctx
  )

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

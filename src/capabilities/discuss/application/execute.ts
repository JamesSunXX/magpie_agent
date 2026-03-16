import type { CapabilityContext } from '../../../core/capability/context.js'
import { runDiscussFlow } from '../runtime/flow.js'
import type { DiscussExecutionResult, DiscussPreparedInput } from '../types.js'

export async function executeDiscuss(
  prepared: DiscussPreparedInput,
  ctx: CapabilityContext
): Promise<DiscussExecutionResult> {
  const payload = await runDiscussFlow({
    topic: prepared.topic,
    options: prepared.options,
    cwd: ctx.cwd,
  })

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

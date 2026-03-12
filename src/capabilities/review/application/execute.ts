import type { CapabilityContext } from '../../../core/capability/context.js'
import { serializeCliOptions } from '../../../core/capability/cli-options.js'
import { runCapabilitySubprocess } from '../../../core/capability/subprocess.js'
import type { ReviewExecutionResult, ReviewPreparedInput } from '../types.js'

export async function executeReview(
  prepared: ReviewPreparedInput,
  ctx: CapabilityContext
): Promise<ReviewExecutionResult> {
  const args = [
    ...(prepared.target ? [prepared.target] : []),
    ...serializeCliOptions(prepared.options),
  ]
  const payload = await runCapabilitySubprocess('review', args, ctx)

  return {
    status: payload.exitCode === 0 ? 'completed' : 'failed',
    payload,
  }
}

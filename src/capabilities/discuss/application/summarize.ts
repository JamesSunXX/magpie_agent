import type { CapabilityContext } from '../../../core/capability/context.js'
import type { DiscussExecutionResult, DiscussSummaryOutput } from '../types.js'

export async function summarizeDiscuss(
  result: DiscussExecutionResult,
  _ctx: CapabilityContext
): Promise<DiscussSummaryOutput> {
  return {
    summary: result.status === 'completed'
      ? 'Discuss capability execution completed.'
      : 'Discuss capability execution failed.',
    details: result.payload,
  }
}

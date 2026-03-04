import type { CapabilityContext } from '../../../core/capability/context.js'
import type { TrdExecutionResult, TrdSummaryOutput } from '../types.js'

export async function summarizeTrd(
  result: TrdExecutionResult,
  _ctx: CapabilityContext
): Promise<TrdSummaryOutput> {
  return {
    summary: result.status === 'completed'
      ? 'TRD capability execution completed.'
      : 'TRD capability delegated to legacy flow.',
    details: result.payload,
  }
}

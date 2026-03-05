import type { CapabilityContext } from '../../../core/capability/context.js'
import type { LoopExecutionResult, LoopSummaryOutput } from '../types.js'

export async function summarizeLoop(
  result: LoopExecutionResult,
  _ctx: CapabilityContext
): Promise<LoopSummaryOutput> {
  return {
    summary: result.summary,
    details: result.sessions || result.session,
  }
}

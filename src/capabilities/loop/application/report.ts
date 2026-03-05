import type { CapabilityContext } from '../../../core/capability/context.js'
import type { LoopSummaryOutput } from '../types.js'

export async function reportLoopSummary(output: LoopSummaryOutput, ctx: CapabilityContext): Promise<void> {
  ctx.logger.info(`[loop] ${output.summary}`)
}

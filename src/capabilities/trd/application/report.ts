import type { CapabilityContext } from '../../../core/capability/context.js'
import type { TrdSummaryOutput } from '../types.js'

export async function reportTrdSummary(output: TrdSummaryOutput, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[trd]', output.summary)
}

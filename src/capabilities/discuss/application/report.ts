import type { CapabilityContext } from '../../../core/capability/context.js'
import type { DiscussSummaryOutput } from '../types.js'

export async function reportDiscussSummary(output: DiscussSummaryOutput, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[discuss]', output.summary)
}

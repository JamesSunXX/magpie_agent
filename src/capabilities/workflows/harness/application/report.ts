import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { HarnessSummary } from '../types.js'

export async function reportHarness(output: HarnessSummary, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[harness]', output.summary)
}


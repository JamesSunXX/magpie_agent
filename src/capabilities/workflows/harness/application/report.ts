import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { HarnessSummary } from '../types.js'

export async function reportHarness(output: HarnessSummary, ctx: CapabilityContext): Promise<void> {
  if (output.details?.status === 'failed') {
    ctx.logger.error('[harness]', output.summary)
  } else {
    ctx.logger.info('[harness]', output.summary)
  }
}

import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { HarnessSummary } from '../types.js'

export async function reportHarness(output: HarnessSummary, ctx: CapabilityContext): Promise<void> {
  const failed = output.details?.status === 'failed'
    || (!output.details && /fail/i.test(output.summary))
  if (failed) {
    ctx.logger.error('[harness]', output.summary)
  } else {
    ctx.logger.info('[harness]', output.summary)
  }
}

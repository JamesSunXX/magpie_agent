import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { DocsSyncSummary } from '../types.js'

export async function reportDocsSync(output: DocsSyncSummary, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[docs-sync]', output.summary)
}

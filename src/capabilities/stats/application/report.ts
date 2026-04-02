import type { CapabilityContext } from '../../../core/capability/context.js'
import { printStatsSummary } from '../presentation/cli-output.js'
import type { StatsSummary } from '../types.js'

export async function reportStats(summary: StatsSummary, _ctx: CapabilityContext): Promise<void> {
  printStatsSummary(summary)
}

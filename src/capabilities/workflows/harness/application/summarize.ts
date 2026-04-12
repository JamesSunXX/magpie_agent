import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { HarnessResult, HarnessSummary } from '../types.js'

export async function summarizeHarness(
  result: HarnessResult,
  _ctx: CapabilityContext
): Promise<HarnessSummary> {
  return {
    summary: result.session?.summary
      ?? (result.status === 'completed'
        ? 'Harness workflow completed.'
        : result.status === 'blocked'
          ? 'Harness workflow paused.'
          : 'Harness workflow failed.'),
    details: result.session,
  }
}

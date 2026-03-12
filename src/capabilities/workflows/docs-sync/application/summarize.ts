import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { DocsSyncResult, DocsSyncSummary } from '../types.js'

export async function summarizeDocsSync(
  result: DocsSyncResult,
  _ctx: CapabilityContext
): Promise<DocsSyncSummary> {
  return {
    summary: result.status === 'completed'
      ? 'Docs-sync workflow completed.'
      : 'Docs-sync workflow failed.',
    details: result.session,
  }
}

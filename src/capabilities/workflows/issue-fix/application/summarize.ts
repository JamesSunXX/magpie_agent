import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { IssueFixResult, IssueFixSummary } from '../types.js'

export async function summarizeIssueFix(
  result: IssueFixResult,
  _ctx: CapabilityContext
): Promise<IssueFixSummary> {
  return {
    summary: result.status === 'completed'
      ? 'Issue-fix workflow completed.'
      : 'Issue-fix workflow failed.',
    details: result.session,
  }
}

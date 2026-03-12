import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { IssueFixSummary } from '../types.js'

export async function reportIssueFix(output: IssueFixSummary, ctx: CapabilityContext): Promise<void> {
  ctx.logger.debug('[issue-fix]', output.summary)
}

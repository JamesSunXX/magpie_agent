import type { CapabilityModule } from '../../../core/capability/types.js'
import { executeIssueFix } from './application/execute.js'
import { prepareIssueFixInput } from './application/prepare.js'
import { reportIssueFix } from './application/report.js'
import { summarizeIssueFix } from './application/summarize.js'
import type { IssueFixInput, IssueFixPreparedInput, IssueFixResult, IssueFixSummary } from './types.js'

export const issueFixCapability: CapabilityModule<
  IssueFixInput,
  IssueFixPreparedInput,
  IssueFixResult,
  IssueFixSummary
> = {
  name: 'issue-fix',
  prepare: prepareIssueFixInput,
  execute: executeIssueFix,
  summarize: summarizeIssueFix,
  report: reportIssueFix,
}

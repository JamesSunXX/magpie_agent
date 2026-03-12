import type { CapabilityModule } from '../../../core/capability/types.js'
import { executeDocsSync } from './application/execute.js'
import { prepareDocsSyncInput } from './application/prepare.js'
import { reportDocsSync } from './application/report.js'
import { summarizeDocsSync } from './application/summarize.js'
import type { DocsSyncInput, DocsSyncPreparedInput, DocsSyncResult, DocsSyncSummary } from './types.js'

export const docsSyncCapability: CapabilityModule<
  DocsSyncInput,
  DocsSyncPreparedInput,
  DocsSyncResult,
  DocsSyncSummary
> = {
  name: 'docs-sync',
  prepare: prepareDocsSyncInput,
  execute: executeDocsSync,
  summarize: summarizeDocsSync,
  report: reportDocsSync,
}

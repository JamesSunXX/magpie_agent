import type { CapabilityModule } from '../../core/capability/types.js'
import { executeDiscuss } from './application/execute.js'
import { prepareDiscussInput } from './application/prepare.js'
import { reportDiscussSummary } from './application/report.js'
import { summarizeDiscuss } from './application/summarize.js'
import type {
  DiscussCapabilityInput,
  DiscussExecutionResult,
  DiscussPreparedInput,
  DiscussSummaryOutput,
} from './types.js'

export const discussCapability: CapabilityModule<
  DiscussCapabilityInput,
  DiscussPreparedInput,
  DiscussExecutionResult,
  DiscussSummaryOutput
> = {
  name: 'discuss',
  prepare: prepareDiscussInput,
  execute: executeDiscuss,
  summarize: summarizeDiscuss,
  report: reportDiscussSummary,
}

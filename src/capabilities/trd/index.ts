import type { CapabilityModule } from '../../core/capability/types.js'
import { executeTrd } from './application/execute.js'
import { prepareTrdInput } from './application/prepare.js'
import { reportTrdSummary } from './application/report.js'
import { summarizeTrd } from './application/summarize.js'
import type {
  TrdCapabilityInput,
  TrdExecutionResult,
  TrdPreparedInput,
  TrdSummaryOutput,
} from './types.js'

export const trdCapability: CapabilityModule<
  TrdCapabilityInput,
  TrdPreparedInput,
  TrdExecutionResult,
  TrdSummaryOutput
> = {
  name: 'trd',
  prepare: prepareTrdInput,
  execute: executeTrd,
  summarize: summarizeTrd,
  report: reportTrdSummary,
}

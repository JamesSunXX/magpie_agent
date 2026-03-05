import type { CapabilityModule } from '../../core/capability/types.js'
import { executeLoop } from './application/execute.js'
import { prepareLoopInput } from './application/prepare.js'
import { reportLoopSummary } from './application/report.js'
import { summarizeLoop } from './application/summarize.js'
import type {
  LoopCapabilityInput,
  LoopExecutionResult,
  LoopPreparedInput,
  LoopSummaryOutput,
} from './types.js'

export const loopCapability: CapabilityModule<
  LoopCapabilityInput,
  LoopPreparedInput,
  LoopExecutionResult,
  LoopSummaryOutput
> = {
  name: 'loop',
  prepare: prepareLoopInput,
  execute: executeLoop,
  summarize: summarizeLoop,
  report: reportLoopSummary,
}

import type { CapabilityModule } from '../../../core/capability/types.js'
import { executeHarness } from './application/execute.js'
import { prepareHarnessInput } from './application/prepare.js'
import { reportHarness } from './application/report.js'
import { summarizeHarness } from './application/summarize.js'
import type { HarnessInput, HarnessPreparedInput, HarnessResult, HarnessSummary } from './types.js'

export const harnessCapability: CapabilityModule<
  HarnessInput,
  HarnessPreparedInput,
  HarnessResult,
  HarnessSummary
> = {
  name: 'harness',
  prepare: prepareHarnessInput,
  execute: executeHarness,
  summarize: summarizeHarness,
  report: reportHarness,
}


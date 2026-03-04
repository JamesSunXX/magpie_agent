import type { CapabilityModule } from '../../../core/capability/types.js'
import { executeUnitTestEval } from './application/execute.js'
import { prepareUnitTestEval } from './application/prepare.js'
import { reportUnitTestEval } from './application/report.js'
import { summarizeUnitTestEval } from './application/summarize.js'
import type {
  UnitTestEvalInput,
  UnitTestEvalPrepared,
  UnitTestEvalResult,
  UnitTestEvalSummary,
} from './types.js'

export const unitTestEvalCapability: CapabilityModule<
  UnitTestEvalInput,
  UnitTestEvalPrepared,
  UnitTestEvalResult,
  UnitTestEvalSummary
> = {
  name: 'quality/unit-test-eval',
  prepare: prepareUnitTestEval,
  execute: executeUnitTestEval,
  summarize: summarizeUnitTestEval,
  report: reportUnitTestEval,
}

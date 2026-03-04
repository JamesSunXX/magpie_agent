import type { CapabilityContext } from '../../../../core/capability/context.js'
import { printUnitTestEvalSummary } from '../presentation/cli-output.js'
import type { UnitTestEvalSummary } from '../types.js'

export async function reportUnitTestEval(summary: UnitTestEvalSummary, _ctx: CapabilityContext): Promise<void> {
  printUnitTestEvalSummary(summary)
}

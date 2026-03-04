import type { CapabilityContext } from '../../../../core/capability/context.js'
import { estimateCoverage } from '../domain/coverage-analyzer.js'
import { scoreUnitTestQuality } from '../domain/scorer.js'
import { generateCandidateTests } from '../domain/test-generator.js'
import { runTestCommand } from '../domain/test-runner.js'
import type { UnitTestEvalPrepared, UnitTestEvalResult } from '../types.js'

export async function executeUnitTestEval(
  prepared: UnitTestEvalPrepared,
  _ctx: CapabilityContext
): Promise<UnitTestEvalResult> {
  const generatedTests = generateCandidateTests(prepared.sourceFiles)
  const coverage = estimateCoverage(prepared.sourceFiles, prepared.testFiles)
  const testRun = prepared.runTests
    ? runTestCommand(prepared.cwd, prepared.testCommand)
    : undefined

  const scores = scoreUnitTestQuality(coverage, prepared.minCoverage, testRun)

  return {
    generatedTests,
    testRun,
    coverage,
    scores,
  }
}

import type { EvaluationScore } from '../../../../shared/types/common.js'
import type { CoverageResult, TestRunResult } from '../types.js'

export function scoreUnitTestQuality(
  coverage: CoverageResult,
  minCoverage: number,
  testRun?: TestRunResult
): EvaluationScore[] {
  const coverageScore = Math.round(coverage.estimatedCoverage * 100)
  const coveragePassed = coverage.estimatedCoverage >= minCoverage

  const testExecutionScore = testRun
    ? (testRun.passed ? 100 : 30)
    : 60

  const overall = Math.round((coverageScore * 0.6) + (testExecutionScore * 0.4))

  return [
    {
      name: 'coverage',
      score: coverageScore,
      reason: coveragePassed
        ? `Estimated coverage ${coverageScore}% meets target ${Math.round(minCoverage * 100)}%`
        : `Estimated coverage ${coverageScore}% is below target ${Math.round(minCoverage * 100)}%`,
    },
    {
      name: 'test_execution',
      score: testExecutionScore,
      reason: testRun
        ? (testRun.passed ? 'Test command passed.' : 'Test command failed.')
        : 'Test command not executed (use --run-tests to enable).',
    },
    {
      name: 'overall',
      score: overall,
      reason: 'Weighted score: coverage 60% + test execution 40%',
    },
  ]
}

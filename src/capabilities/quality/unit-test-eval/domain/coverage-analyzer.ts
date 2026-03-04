import type { CoverageResult } from '../types.js'

export function estimateCoverage(sourceFiles: string[], testFiles: string[]): CoverageResult {
  const sourceFileCount = sourceFiles.length
  const testFileCount = testFiles.length

  // Heuristic only: count test-to-source ratio as a proxy when real coverage report is unavailable.
  const estimatedCoverage = sourceFileCount === 0
    ? 1
    : Math.min(1, testFileCount / sourceFileCount)

  return {
    sourceFileCount,
    testFileCount,
    estimatedCoverage,
  }
}

import type { EvaluationScore } from '../../../shared/types/common.js'

export interface UnitTestEvalInput {
  path?: string
  maxFiles?: number
  minCoverage?: number
  format?: 'markdown' | 'json'
  runTests?: boolean
  testCommand?: string
}

export interface UnitTestEvalPrepared {
  cwd: string
  sourceFiles: string[]
  testFiles: string[]
  maxFiles: number
  minCoverage: number
  format: 'markdown' | 'json'
  runTests: boolean
  testCommand: string
}

export interface CandidateTest {
  sourceFile: string
  suggestedTestFile: string
  rationale: string
}

export interface TestRunResult {
  command: string
  passed: boolean
  output: string
  exitCode: number
}

export interface CoverageResult {
  sourceFileCount: number
  testFileCount: number
  estimatedCoverage: number
}

export interface UnitTestEvalResult {
  generatedTests: CandidateTest[]
  testRun?: TestRunResult
  coverage: CoverageResult
  scores: EvaluationScore[]
}

export interface UnitTestEvalSummary {
  format: 'markdown' | 'json'
  text: string
  json: {
    coverage: CoverageResult
    scores: EvaluationScore[]
    generatedTests: CandidateTest[]
    testRun?: TestRunResult
  }
}

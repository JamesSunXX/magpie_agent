import { basename, dirname, extname, join } from 'path'
import type { CandidateTest } from '../types.js'

function toTestPath(sourceFile: string): string {
  const ext = extname(sourceFile)
  const file = basename(sourceFile, ext)
  const dir = dirname(sourceFile)

  if (dir.startsWith('src/')) {
    const testDir = dir.replace(/^src\//, 'tests/')
    return join(testDir, `${file}.test.ts`)
  }

  return join('tests', `${file}.test.ts`)
}

export function generateCandidateTests(sourceFiles: string[]): CandidateTest[] {
  return sourceFiles.map((sourceFile) => ({
    sourceFile,
    suggestedTestFile: toTestPath(sourceFile),
    rationale: 'Prioritize behavior-focused unit tests for changed or uncovered logic.',
  }))
}

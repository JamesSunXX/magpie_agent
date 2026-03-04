import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { UnitTestEvalResult, UnitTestEvalSummary } from '../types.js'

function toMarkdown(result: UnitTestEvalResult): string {
  const lines = [
    `- Estimated coverage: ${(result.coverage.estimatedCoverage * 100).toFixed(1)}%`,
    `- Source files analyzed: ${result.coverage.sourceFileCount}`,
    `- Test files found: ${result.coverage.testFileCount}`,
    '',
    '## Scores',
    ...result.scores.map((score) => `- ${score.name}: ${score.score} (${score.reason || 'n/a'})`),
    '',
    '## Suggested Tests',
    ...result.generatedTests.slice(0, 20).map((item) => `- ${item.sourceFile} -> ${item.suggestedTestFile}`),
  ]

  if (result.testRun) {
    lines.push('', '## Test Run', `- Command: ${result.testRun.command}`, `- Passed: ${result.testRun.passed}`)
  }

  return lines.join('\n')
}

export async function summarizeUnitTestEval(
  result: UnitTestEvalResult,
  ctx: CapabilityContext
): Promise<UnitTestEvalSummary> {
  const requestedFormat = (ctx.metadata?.format as 'markdown' | 'json' | undefined) || 'markdown'

  return {
    format: requestedFormat,
    text: toMarkdown(result),
    json: {
      coverage: result.coverage,
      scores: result.scores,
      generatedTests: result.generatedTests,
      testRun: result.testRun,
    },
  }
}

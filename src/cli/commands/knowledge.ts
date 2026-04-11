import type { KnowledgeArtifacts, KnowledgeState } from '../../knowledge/runtime.js'
import { formatKnowledgeStateSummary, loadInspectSnapshot, resolveKnowledgeState } from '../../knowledge/runtime.js'

function formatLine(label: string, value: string): string {
  return `${label}: ${value || '(none)'}`
}

export async function printKnowledgeSummary(
  artifacts: Partial<KnowledgeArtifacts> | undefined
): Promise<void> {
  if (!artifacts?.knowledgeSummaryDir) {
    return
  }

  const snapshot = await loadInspectSnapshot({
    knowledgeSchemaPath: artifacts.knowledgeSchemaPath || `${artifacts.knowledgeSummaryDir}/../SCHEMA.md`,
    knowledgeIndexPath: artifacts.knowledgeIndexPath || `${artifacts.knowledgeSummaryDir}/../index.md`,
    knowledgeLogPath: artifacts.knowledgeLogPath || `${artifacts.knowledgeSummaryDir}/../log.md`,
    knowledgeStatePath: artifacts.knowledgeStatePath || `${artifacts.knowledgeSummaryDir}/../state.json`,
    knowledgeSummaryDir: artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: artifacts.knowledgeCandidatesPath || `${artifacts.knowledgeSummaryDir}/../candidates.json`,
  })

  console.log(formatLine('Latest summary', snapshot.latestSummary))
  console.log(formatLine('Knowledge', snapshot.knowledgeDir))
}

export async function printKnowledgeInspectView(
  artifacts: Partial<KnowledgeArtifacts> | undefined,
  fallbackState?: Partial<KnowledgeState>
): Promise<void> {
  if (!artifacts?.knowledgeSummaryDir) {
    console.log('Knowledge: unavailable')
    return
  }

  const snapshot = await loadInspectSnapshot({
    knowledgeSchemaPath: artifacts.knowledgeSchemaPath || `${artifacts.knowledgeSummaryDir}/../SCHEMA.md`,
    knowledgeIndexPath: artifacts.knowledgeIndexPath || `${artifacts.knowledgeSummaryDir}/../index.md`,
    knowledgeLogPath: artifacts.knowledgeLogPath || `${artifacts.knowledgeSummaryDir}/../log.md`,
    knowledgeStatePath: artifacts.knowledgeStatePath || `${artifacts.knowledgeSummaryDir}/../state.json`,
    knowledgeSummaryDir: artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: artifacts.knowledgeCandidatesPath || `${artifacts.knowledgeSummaryDir}/../candidates.json`,
  })
  const state = artifacts.knowledgeStatePath
    ? snapshot.state
    : resolveKnowledgeState(fallbackState)
  const candidateLine = snapshot.candidates.length > 0
    ? snapshot.candidates.map((candidate) => `${candidate.type}:${candidate.title}`).join(', ')
    : '(none)'

  console.log(formatLine('Goal', snapshot.goal))
  console.log(formatLine('State', formatKnowledgeStateSummary(state)))
  console.log(formatLine('Latest summary', snapshot.latestSummary))
  console.log(formatLine('Open issues', snapshot.openIssues))
  console.log(formatLine('Evidence', snapshot.evidence))
  console.log(formatLine('Candidates', candidateLine))
  console.log(formatLine('Knowledge', snapshot.knowledgeDir))
}

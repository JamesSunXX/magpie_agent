import type { KnowledgeArtifacts } from '../../knowledge/runtime.js'
import { loadInspectSnapshot } from '../../knowledge/runtime.js'

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
    knowledgeSummaryDir: artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: artifacts.knowledgeCandidatesPath || `${artifacts.knowledgeSummaryDir}/../candidates.json`,
  })

  console.log(formatLine('Latest summary', snapshot.latestSummary))
  console.log(formatLine('Knowledge', snapshot.knowledgeDir))
}

export async function printKnowledgeInspectView(
  artifacts: Partial<KnowledgeArtifacts> | undefined
): Promise<void> {
  if (!artifacts?.knowledgeSummaryDir) {
    console.log('Knowledge: unavailable')
    return
  }

  const snapshot = await loadInspectSnapshot({
    knowledgeSchemaPath: artifacts.knowledgeSchemaPath || `${artifacts.knowledgeSummaryDir}/../SCHEMA.md`,
    knowledgeIndexPath: artifacts.knowledgeIndexPath || `${artifacts.knowledgeSummaryDir}/../index.md`,
    knowledgeLogPath: artifacts.knowledgeLogPath || `${artifacts.knowledgeSummaryDir}/../log.md`,
    knowledgeSummaryDir: artifacts.knowledgeSummaryDir,
    knowledgeCandidatesPath: artifacts.knowledgeCandidatesPath || `${artifacts.knowledgeSummaryDir}/../candidates.json`,
  })
  const candidateLine = snapshot.candidates.length > 0
    ? snapshot.candidates.map((candidate) => `${candidate.type}:${candidate.title}`).join(', ')
    : '(none)'

  console.log(formatLine('Goal', snapshot.goal))
  console.log(formatLine('Latest summary', snapshot.latestSummary))
  console.log(formatLine('Open issues', snapshot.openIssues))
  console.log(formatLine('Evidence', snapshot.evidence))
  console.log(formatLine('Candidates', candidateLine))
  console.log(formatLine('Knowledge', snapshot.knowledgeDir))
}

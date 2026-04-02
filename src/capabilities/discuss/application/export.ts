import { writeFileSync } from 'fs'
import { StateManager } from '../../../core/state/index.js'
import type { DiscussSession } from '../../../core/state/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import type { MagpieConfigV2 } from '../../../platform/config/types.js'
import { createProvider } from '../../../platform/providers/index.js'
import { formatDiscussConclusion, formatDiscussMarkdown } from '../runtime/flow.js'
import type { DiscussOptions } from '../types.js'

export interface ExportDiscussSessionInput {
  options: DiscussOptions
  cwd: string
}

export interface DiscussExportResult {
  kind: 'plan' | 'discussion'
  outputFile: string
  sessionId: string
}

const DISCUSS_PLAN_REPORT_SYSTEM_PROMPT = `You convert a completed discussion into an actionable implementation plan report.

Write the report in the same language as the discussion.
Do not retell the debate chronologically unless it is required to explain an unresolved point.
Only include claims that are supported by the discussion content.
If a detail is still unclear or disputed, mark it explicitly as unresolved.`

export function validateDiscussExportOptions(options: DiscussOptions): string | undefined {
  if (options.planReport && !options.export) {
    return '--plan-report requires --export <id>'
  }

  if (options.planReport && options.conclusion) {
    return '--plan-report cannot be combined with --conclusion'
  }

  if (options.planReport && options.format === 'json') {
    return '--plan-report currently supports markdown output only'
  }

  return undefined
}

function resolveMatchedSession(sessions: DiscussSession[], exportId: string): DiscussSession {
  const match = sessions.filter(s => s.id.startsWith(exportId) || s.id === exportId)

  if (match.length === 0) {
    throw new Error(`No session found matching "${exportId}"`)
  }

  if (match.length > 1) {
    const ids = match.map(s => `  - ${s.id} ${s.title}`).join('\n')
    throw new Error(`Multiple sessions match "${exportId}"\n${ids}`)
  }

  return match[0]
}

function formatRoundForPlanPrompt(round: DiscussSession['rounds'][number]): string {
  const messageLines = round.messages
    .map(message => `- ${message.reviewerId}: ${message.content}`)
    .join('\n')
  const summaryLines = round.summaries
    .map(summary => `- ${summary.reviewerId}: ${summary.summary}`)
    .join('\n')

  return [
    `## Round ${round.roundNumber}`,
    `Topic: ${round.topic}`,
    '',
    'Analysis:',
    round.analysis,
    '',
    'Messages:',
    messageLines || '- None',
    '',
    'Round Summaries:',
    summaryLines || '- None',
    '',
    'Conclusion:',
    round.conclusion,
  ].join('\n')
}

export function buildDiscussPlanReportPrompt(session: DiscussSession): string {
  const rounds = session.rounds.map(formatRoundForPlanPrompt).join('\n\n')

  return `Turn the following discussion session into an actionable Markdown plan report.

Required sections:
## Background and Final Judgment
## In Scope
## Out of Scope
## Execution Steps
- Use a numbered list in execution order
- For each step, include a short "Done when:" acceptance line
## Risks, Dependencies, and Open Questions
## Recommended Next Steps

Rules:
- Base the report on the full discussion, not only the final conclusion
- Keep unresolved disagreements visible
- Be specific enough that a team can start implementation from this report
- Do not add technical details that were never discussed

Discussion session:
Session: ${session.id}
Title: ${session.title}
Reviewers: ${session.reviewerIds.join(', ')}

${rounds}`
}

async function generateDiscussPlanReport(
  session: DiscussSession,
  config: MagpieConfigV2,
  cwd?: string
): Promise<string> {
  const provider = createProvider(config.summarizer.model, config)
  provider.setCwd?.(cwd ?? process.cwd())

  return provider.chat(
    [
      {
        role: 'user',
        content: buildDiscussPlanReportPrompt(session),
      },
    ],
    DISCUSS_PLAN_REPORT_SYSTEM_PROMPT
  )
}

function resolveOutputFile(session: DiscussSession, options: DiscussOptions): string {
  if (options.output) {
    return options.output
  }

  if (options.planReport) {
    return `discuss-plan-${session.id}.md`
  }

  return `discuss-${session.id}.md`
}

function renderStandardDiscussExport(session: DiscussSession, options: DiscussOptions): string {
  if (options.format === 'json') {
    return JSON.stringify(session, null, 2)
  }

  return options.conclusion ? formatDiscussConclusion(session) : formatDiscussMarkdown(session)
}

export async function exportDiscussSession(input: ExportDiscussSessionInput): Promise<DiscussExportResult> {
  const validationError = validateDiscussExportOptions(input.options)
  if (validationError) {
    throw new Error(validationError)
  }

  const stateManager = new StateManager(input.cwd)
  await stateManager.initDiscussions()
  const sessions = await stateManager.listDiscussSessions()
  const session = resolveMatchedSession(sessions, input.options.export!)
  const outputFile = resolveOutputFile(session, input.options)

  const content = input.options.planReport
    ? await generateDiscussPlanReport(session, loadConfig(input.options.config), input.cwd)
    : renderStandardDiscussExport(session, input.options)

  writeFileSync(outputFile, content, 'utf-8')

  return {
    kind: input.options.planReport ? 'plan' : 'discussion',
    outputFile,
    sessionId: session.id,
  }
}

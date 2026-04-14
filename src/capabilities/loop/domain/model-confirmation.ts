import { createConfiguredProvider } from '../../../platform/providers/index.js'
import type { MagpieConfig, LoopStageName } from '../../../config/types.js'
import { extractJsonBlock } from '../../../trd/renderer.js'

export type ModelConfirmationDecision = 'approved' | 'revise' | 'human_required'

interface RawModelConfirmation {
  decision?: ModelConfirmationDecision
  rationale?: string
  required_actions?: string[]
}

export interface ModelReviewerDecision {
  reviewerId: string
  decision: ModelConfirmationDecision
  rationale: string
  requiredActions: string[]
}

export interface LoopModelConfirmationResult {
  decision: ModelConfirmationDecision
  rationale: string
  requiredActions: string[]
  reviewers: ModelReviewerDecision[]
  arbitrator?: ModelReviewerDecision
}

export interface RunLoopModelConfirmationInput {
  stage: LoopStageName
  goal: string
  stageReport: string
  testOutput: string
  risks: string[]
  reviewerIds: string[]
  config: MagpieConfig
  cwd: string
}

const REVIEWER_PROMPT = `You are reviewing whether a Magpie loop stage may continue autonomously.

Return ONLY JSON with this schema:
\`\`\`json
{
  "decision": "approved|revise|human_required",
  "rationale": "short explanation",
  "required_actions": ["..."]
}
\`\`\`

Rules:
- Use "approved" only when the stage is safe to continue without human input.
- Use "revise" when autonomous follow-up is possible and concrete fixes are known.
- Use "human_required" when the risk, ambiguity, or impact is too high for autonomous approval.
- Keep required_actions empty when decision is approved or human_required.`

const ARBITRATOR_PROMPT = `You are the final arbitrator for a Magpie loop stage gate.

Return ONLY JSON with this schema:
\`\`\`json
{
  "decision": "approved|revise|human_required",
  "rationale": "short explanation",
  "required_actions": ["..."]
}
\`\`\`

Rules:
- Resolve reviewer disagreement.
- Use "human_required" when the disagreement reflects material risk or insufficient evidence.
- Keep required_actions concrete and minimal when decision is revise.`

function parseModelConfirmation(raw: string, actor: string): Omit<ModelReviewerDecision, 'reviewerId'> {
  const parsed = extractJsonBlock<RawModelConfirmation>(raw)
  if (!parsed) {
    throw new Error(`${actor} returned unparsable model confirmation JSON`)
  }

  if (
    parsed.decision !== 'approved'
    && parsed.decision !== 'revise'
    && parsed.decision !== 'human_required'
  ) {
    throw new Error(`${actor} returned invalid decision "${String(parsed.decision)}"`)
  }

  return {
    decision: parsed.decision,
    rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim()
      : 'No rationale provided.',
    requiredActions: Array.isArray(parsed.required_actions)
      ? parsed.required_actions.map((item) => String(item).trim()).filter(Boolean)
      : [],
  }
}

function buildReviewerInput(input: RunLoopModelConfirmationInput): string {
  return [
    `Stage: ${input.stage}`,
    `Goal: ${input.goal}`,
    '',
    'Risks:',
    ...(input.risks.length > 0 ? input.risks.map((risk) => `- ${risk}`) : ['- None']),
    '',
    'Stage report:',
    input.stageReport || '(none)',
    '',
    'Test output:',
    input.testOutput || '(none)',
  ].join('\n')
}

function buildArbitratorInput(
  input: RunLoopModelConfirmationInput,
  reviewerDecisions: ModelReviewerDecision[]
): string {
  return [
    buildReviewerInput(input),
    '',
    'Reviewer decisions:',
    ...reviewerDecisions.map((decision) => [
      `- ${decision.reviewerId}: ${decision.decision}`,
      `  rationale: ${decision.rationale}`,
      `  required_actions: ${decision.requiredActions.length > 0 ? decision.requiredActions.join('; ') : '(none)'}`,
    ].join('\n')),
  ].join('\n')
}

function uniqueRequiredActions(decisions: Array<Pick<ModelReviewerDecision, 'requiredActions'>>): string[] {
  return Array.from(new Set(decisions.flatMap((decision) => decision.requiredActions.map((item) => item.trim()).filter(Boolean))))
}

export async function runLoopModelConfirmation(
  input: RunLoopModelConfirmationInput
): Promise<LoopModelConfirmationResult> {
  const reviewerPrompt = buildReviewerInput(input)
  const reviewers: ModelReviewerDecision[] = []

  for (const reviewerId of input.reviewerIds) {
    const reviewer = input.config.reviewers?.[reviewerId]
    if (!reviewer) {
      throw new Error(`Unknown loop model reviewer "${reviewerId}"`)
    }

    const provider = createConfiguredProvider({
      logicalName: `reviewers.${reviewerId}`,
      tool: reviewer.tool,
      model: reviewer.model,
      agent: reviewer.agent,
    }, input.config)
    provider.setCwd?.(input.cwd)

    const raw = await provider.chat([{ role: 'user', content: reviewerPrompt }], REVIEWER_PROMPT, { disableTools: true })
    reviewers.push({
      reviewerId,
      ...parseModelConfirmation(raw, reviewerId),
    })
  }

  if (reviewers.some((reviewer) => reviewer.decision === 'human_required')) {
    const rationale = reviewers
      .filter((reviewer) => reviewer.decision === 'human_required')
      .map((reviewer) => `${reviewer.reviewerId}: ${reviewer.rationale}`)
      .join(' | ')
    return {
      decision: 'human_required',
      rationale,
      requiredActions: [],
      reviewers,
    }
  }

  if (reviewers.every((reviewer) => reviewer.decision === 'approved')) {
    return {
      decision: 'approved',
      rationale: reviewers.map((reviewer) => `${reviewer.reviewerId}: ${reviewer.rationale}`).join(' | '),
      requiredActions: [],
      reviewers,
    }
  }

  if (reviewers.every((reviewer) => reviewer.decision === 'revise')) {
    return {
      decision: 'revise',
      rationale: reviewers.map((reviewer) => `${reviewer.reviewerId}: ${reviewer.rationale}`).join(' | '),
      requiredActions: uniqueRequiredActions(reviewers),
      reviewers,
    }
  }

  const summarizer = input.config.summarizer
  const arbitratorProvider = createConfiguredProvider({
    logicalName: 'summarizer',
    tool: summarizer.tool,
    model: summarizer.model,
    agent: summarizer.agent,
  }, input.config)
  arbitratorProvider.setCwd?.(input.cwd)

  const arbitratorRaw = await arbitratorProvider.chat(
    [{ role: 'user', content: buildArbitratorInput(input, reviewers) }],
    ARBITRATOR_PROMPT,
    { disableTools: true }
  )
  const arbitrator = {
    reviewerId: 'summarizer',
    ...parseModelConfirmation(arbitratorRaw, 'summarizer'),
  }

  return {
    decision: arbitrator.decision,
    rationale: arbitrator.rationale,
    requiredActions: arbitrator.decision === 'revise' ? uniqueRequiredActions([...reviewers, arbitrator]) : [],
    reviewers,
    arbitrator,
  }
}

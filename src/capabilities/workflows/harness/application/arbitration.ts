import { extractJsonBlock } from '../../../../trd/renderer.js'
import type { RoleFinalAction } from '../../../../core/roles/index.js'

export interface HarnessArbitrationDecision {
  decision?: 'approved' | 'revise'
  rationale?: string
  requiredActions?: string[]
}

export interface HarnessArbitrationOutcome {
  decision: HarnessArbitrationDecision | null
  approved: boolean
  finalAction: RoleFinalAction
  rationale: string
  nextRoundBrief: string
  shouldRequestIssueFix: boolean
}

const DEFAULT_REVISE_BRIEF = 'Address blocking review findings and rerun the checks.'
const DEFAULT_BLOCKED_BRIEF = 'Adjudication did not produce an actionable next step.'
const DEFAULT_RATIONALE = 'No parsable decision returned by discuss final conclusion.'

function normalizeHarnessDecision(
  value: unknown
): HarnessArbitrationDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as {
    decision?: unknown
    rationale?: unknown
    requiredActions?: unknown
  }
  const normalizedDecision = typeof record.decision === 'string'
    ? record.decision.trim().toLowerCase()
    : ''

  if (normalizedDecision !== 'approved' && normalizedDecision !== 'revise') {
    return null
  }

  const requiredActions = Array.isArray(record.requiredActions)
    ? record.requiredActions
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
    : null

  return {
    decision: normalizedDecision,
    ...(typeof record.rationale === 'string' && record.rationale.trim()
      ? { rationale: record.rationale.trim() }
      : {}),
    ...(requiredActions ? { requiredActions } : {}),
  }
}

function parseNarrativeAction(line: string): string | null {
  const actionMatch = line.match(/^(?:[-*]|\d+\.)\s*(.+)$/)
  if (actionMatch?.[1]) {
    return actionMatch[1].trim() || null
  }

  return line.trim() || null
}

function inferDecisionFromNarrative(text: string): HarnessArbitrationDecision | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n').map(line => line.trim())
  const decisionLineIndex = lines.findIndex(line => /^(?:决定|decision)\s*[:：]\s*(approved|revise)\b/i.test(line))
  if (decisionLineIndex === -1) {
    return null
  }

  const decisionMatch = lines[decisionLineIndex]?.match(/^(?:决定|decision)\s*[:：]\s*(approved|revise)\b/i)
  if (!decisionMatch) {
    return null
  }

  const inferredDecision = decisionMatch[1].toLowerCase() as 'approved' | 'revise'
  let rationale: string | undefined
  const requiredActions: string[] = []
  let collectingActions = false

  for (const line of lines.slice(decisionLineIndex + 1)) {
    if (line.length === 0 || /^(?:>|\|)/.test(line)) {
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      break
    }

    const rationaleMatch = line.match(/^(?:结论|理由|说明|rationale)\s*[:：]\s*(.+)$/i)
    if (rationaleMatch?.[1]) {
      rationale = rationaleMatch[1].trim()
      collectingActions = false
      continue
    }

    const actionHeaderMatch = line.match(/^(?:建议动作|required actions?)\s*[:：]\s*(.*)$/i)
    if (actionHeaderMatch) {
      collectingActions = true
      const inlineAction = parseNarrativeAction(actionHeaderMatch[1] || '')
      if (inlineAction) {
        requiredActions.push(inlineAction)
      }
      continue
    }

    if (collectingActions) {
      const action = parseNarrativeAction(line)
      if (action) {
        requiredActions.push(action)
      }
      continue
    }

    rationale ||= line
  }

  return {
    decision: inferredDecision,
    ...(rationale ? { rationale } : {}),
    ...(requiredActions.length > 0 ? { requiredActions } : {}),
  }
}

export function resolveHarnessArbitrationOutcome(params: {
  finalConclusion: string
  fallbackTexts?: string[]
  blockingIssueCount: number
  testsPassed: boolean
}): HarnessArbitrationOutcome {
  const candidates = [
    params.finalConclusion,
    ...(params.fallbackTexts || []),
  ]
  const decision = candidates
    .map((text) => normalizeHarnessDecision(extractJsonBlock<unknown>(text)) || inferDecisionFromNarrative(text))
    .find((candidate): candidate is HarnessArbitrationDecision => candidate !== null)
    || null
  const approved = params.blockingIssueCount === 0
    && params.testsPassed
    && decision?.decision === 'approved'
  const finalAction: RoleFinalAction = approved
    ? 'approved'
    : decision?.decision === 'revise' || params.blockingIssueCount > 0 || !params.testsPassed
      ? 'revise'
      : 'requeue_or_blocked'
  const requiredActions = (decision?.requiredActions || []).filter(Boolean)
  const rationale = decision?.rationale || DEFAULT_RATIONALE
  const nextRoundBrief = approved
    ? 'No further action.'
    : finalAction === 'revise'
      ? requiredActions.join('; ') || DEFAULT_REVISE_BRIEF
      : requiredActions.join('; ') || decision?.rationale || DEFAULT_BLOCKED_BRIEF

  return {
    decision,
    approved,
    finalAction,
    rationale,
    nextRoundBrief,
    shouldRequestIssueFix: finalAction === 'revise',
  }
}

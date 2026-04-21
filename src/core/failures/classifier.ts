import type { FailureCategory, FailureFactInput } from './types.js'

interface SignatureInput {
  capability: FailureFactInput['capability']
  stage: string
  category: FailureCategory
  reason: string
  rawError?: string
}

const LEGACY_SIGNATURE_CAPABILITIES = new Set<FailureFactInput['capability']>([
  'loop',
  'harness',
  'harness-server',
])

const TRANSIENT_PATTERNS = [
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'disconnect',
  'rate limit',
  '429',
  'tls',
]

const ENVIRONMENT_PATTERNS = [
  'command not found',
  'enoent',
  'not executable',
  'spawn eacces',
  'permission denied',
]

const PROMPT_OR_PARSE_PATTERNS = [
  'invalid json',
  'failed to parse',
  'unexpected token',
  'format missing',
  'missing required field',
  'no parsable json',
]

const WORKFLOW_DEFECT_PATTERNS = [
  'no reliable checkpoint',
  'state mismatch',
  'resume checkpoint',
  'requeue failed',
  'missing queued input metadata',
  'cannot safely resume',
]

function collectMessageParts(fact: Pick<FailureFactInput, 'reason' | 'rawError' | 'metadata'>): string {
  return [
    fact.reason,
    fact.rawError,
    typeof fact.metadata?.failureKind === 'string' ? fact.metadata.failureKind : '',
    typeof fact.metadata?.error === 'string' ? fact.metadata.error : '',
  ].filter(Boolean).join('\n').toLowerCase()
}

export function normalizeFailureMessage(input: string): string {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = line
      .toLowerCase()
      .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/g, '<timestamp>')
      .replace(/(?:[a-z]:)?\/[^\s:]+/gi, '<path>')
      .replace(/\b(?:loop|harness)(?:-[a-z0-9]{4,})+\b/gi, '<session>')
      .replace(/:\d+(?::\d+)?/g, ':<line>')
      .replace(/\|+/g, ' / ')
      .replace(/\s+/g, ' ')
      .trim()

    if (normalized) {
      return normalized.slice(0, 160)
    }
  }

  return ''
}

export function normalizeFailureSignature(signature: string): string {
  const parts = signature.split('|')
  if (parts.length >= 4 && LEGACY_SIGNATURE_CAPABILITIES.has(parts[0] as FailureFactInput['capability'])) {
    return parts.slice(1).join('|')
  }
  return signature
}

export function classifyFailureCategory(
  fact: Pick<FailureFactInput, 'capability' | 'stage' | 'reason' | 'rawError' | 'metadata' | 'retryableHint'>
): FailureCategory {
  const message = collectMessageParts(fact)
  const metadata = fact.metadata || {}

  if (metadata.failureKind === 'permission_denied' || message.includes('permission policy denied')) {
    return 'permission_denied'
  }

  if (metadata.failureKind === 'failure_budget_exhausted' || message.includes('failure budget exhausted')) {
    return 'failure_budget_exhausted'
  }

  if (metadata.failureKind === 'resource_limit' || message.includes('resource limit')) {
    return 'resource_limit'
  }

  if (
    metadata.checkpointMissing === true
    || metadata.stateMismatch === true
    || metadata.requeueFailed === true
    || WORKFLOW_DEFECT_PATTERNS.some((pattern) => message.includes(pattern))
  ) {
    return 'workflow_defect'
  }

  if (PROMPT_OR_PARSE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return 'prompt_or_parse'
  }

  if (
    metadata.failureKind === 'quality'
    || (Array.isArray(metadata.failedTests) && metadata.failedTests.length > 0)
    || message.includes('\nfail ')
    || message.startsWith('fail ')
    || message.includes('expected "') && message.includes('received "')
  ) {
    return 'quality'
  }

  if (
    fact.retryableHint === true
    || TRANSIENT_PATTERNS.some((pattern) => message.includes(pattern))
  ) {
    return 'transient'
  }

  if (
    metadata.failureKind === 'execution'
    || ENVIRONMENT_PATTERNS.some((pattern) => message.includes(pattern))
  ) {
    return 'environment'
  }

  return 'unknown'
}

export function buildFailureSignature(input: SignatureInput): string {
  const keyMessage = normalizeFailureMessage(input.rawError || input.reason) || normalizeFailureMessage(input.reason)
  return normalizeFailureSignature([
    input.stage,
    input.category,
    keyMessage || 'unknown',
  ].join('|'))
}

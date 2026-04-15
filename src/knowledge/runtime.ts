import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'
import {
  loadPersistentMemoryContext,
  syncProjectMemoryFromPromotedKnowledge,
} from '../memory/runtime.js'
import { getProjectStorageKey } from '../platform/project-identity.js'
import { readFailureIndex } from '../core/failures/ledger.js'

export interface KnowledgeArtifacts {
  knowledgeSchemaPath: string
  knowledgeIndexPath: string
  knowledgeLogPath: string
  knowledgeStatePath: string
  knowledgeSummaryDir: string
  knowledgeCandidatesPath: string
}

export type KnowledgeCandidateType = 'decision' | 'failure-pattern' | 'workflow-rule'
export type KnowledgeCandidateStatus = 'candidate' | 'promoted' | 'deferred'
export type KnowledgeLifecycle = 'active' | 'deferred' | 'superseded' | 'retired'

export interface KnowledgeCandidate {
  type: KnowledgeCandidateType
  title: string
  summary: string
  topicKey?: string
  sourceSessionId: string
  evidencePath?: string
  status: KnowledgeCandidateStatus
  whyPromotable?: string
  stability?: string
  scope?: string
  appliesTo?: string[]
  introducedAt?: string
  lastUsedAt?: string
  lifecycle?: KnowledgeLifecycle
  supersededBy?: string
}

export interface KnowledgeState {
  currentStage: string
  lastReliableResult: string
  nextAction: string
  currentBlocker: string
  updatedAt: string
}

export interface InspectSnapshot {
  knowledgeDir: string
  goal: string
  state: KnowledgeState
  latestSummary: string
  openIssues: string
  evidence: string
  candidates: KnowledgeCandidate[]
}

interface CreateTaskKnowledgeOptions {
  sessionDir: string
  capability: 'harness' | 'loop'
  sessionId: string
  title: string
  goal: string
}

export interface PromotionResult {
  repoKey: string
  promoted: KnowledgeCandidate[]
  deferred: KnowledgeCandidate[]
}

const SUMMARY_ORDER = ['goal', 'plan', 'open-issues', 'evidence', 'final']

function knowledgeDirFromArtifacts(artifacts: KnowledgeArtifacts): string {
  return resolve(artifacts.knowledgeSummaryDir, '..')
}

function summaryPath(artifacts: KnowledgeArtifacts, name: string): string {
  return join(artifacts.knowledgeSummaryDir, `${name}.md`)
}

async function safeRead(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

function stripMarkdown(content: string): string {
  return content
    .replace(/^#+\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[*_>`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function removeLeadingLabel(content: string, label: string): string {
  const normalized = stripMarkdown(content)
  const prefix = `${label} `
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length).trim() : normalized
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function candidateTopicKey(candidate: KnowledgeCandidate): string {
  return normalizeKey(candidate.topicKey || candidate.title) || `${candidate.type}-entry`
}

function candidateSlug(candidate: KnowledgeCandidate): string {
  return candidate.type === 'failure-pattern'
    ? candidateTopicKey(candidate)
    : normalizeKey(candidate.title) || candidateTopicKey(candidate)
}

function defaultKnowledgeState(): KnowledgeState {
  return {
    currentStage: 'queued',
    lastReliableResult: 'Knowledge scaffold created.',
    nextAction: 'Generate or update the task plan.',
    currentBlocker: 'Waiting for the first stage result.',
    updatedAt: new Date(0).toISOString(),
  }
}

function toKnowledgeState(input: Partial<KnowledgeState> | undefined, fallback?: KnowledgeState): KnowledgeState {
  const base = fallback || defaultKnowledgeState()
  return {
    currentStage: input?.currentStage || base.currentStage,
    lastReliableResult: input?.lastReliableResult || base.lastReliableResult,
    nextAction: input?.nextAction || base.nextAction,
    currentBlocker: input?.currentBlocker || base.currentBlocker,
    updatedAt: input?.updatedAt || new Date().toISOString(),
  }
}

export function formatKnowledgeStateSummary(state: KnowledgeState): string {
  return [
    state.currentStage || '(unknown)',
    state.nextAction ? `next: ${state.nextAction}` : undefined,
    state.currentBlocker ? `blocker: ${state.currentBlocker}` : undefined,
  ].filter(Boolean).join(' | ')
}

export function resolveKnowledgeState(
  state: Partial<KnowledgeState> | undefined,
  fallback?: KnowledgeState
): KnowledgeState {
  return toKnowledgeState(state, fallback)
}

async function appendLog(artifacts: KnowledgeArtifacts, heading: string, body: string): Promise<void> {
  const existing = await safeRead(artifacts.knowledgeLogPath)
  const next = [
    existing.trimEnd(),
    `## ${heading}`,
    body.trim() || '- no details',
    '',
  ].filter(Boolean).join('\n')
  await writeFile(artifacts.knowledgeLogPath, `${next}\n`, 'utf-8')
}

async function rebuildIndex(artifacts: KnowledgeArtifacts): Promise<void> {
  const entryNames = await listSummaryNames(artifacts)
  const lines = ['# Task Knowledge Index', '', '## Core summaries', '- state.json']
  for (const name of entryNames) {
    lines.push(`- ${name}.md`)
  }
  await writeFile(artifacts.knowledgeIndexPath, `${lines.join('\n')}\n`, 'utf-8')
}

export async function createTaskKnowledge(options: CreateTaskKnowledgeOptions): Promise<KnowledgeArtifacts> {
  const knowledgeDir = join(options.sessionDir, 'knowledge')
  const knowledgeSummaryDir = join(knowledgeDir, 'summaries')
  const artifacts: KnowledgeArtifacts = {
    knowledgeSchemaPath: join(knowledgeDir, 'SCHEMA.md'),
    knowledgeIndexPath: join(knowledgeDir, 'index.md'),
    knowledgeLogPath: join(knowledgeDir, 'log.md'),
    knowledgeStatePath: join(knowledgeDir, 'state.json'),
    knowledgeSummaryDir,
    knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
  }

  await mkdir(knowledgeSummaryDir, { recursive: true })

  await writeFile(artifacts.knowledgeSchemaPath, [
    '# Task Knowledge Schema',
    '',
    '- Keep a concise goal summary, plan summary, state card, open issues, evidence, stage summaries, and final summary.',
    '- Promote only stable decisions, repeated failure patterns, and stable workflow rules.',
    '- Do not overwrite raw artifacts; reference them from summaries instead.',
    '',
  ].join('\n'), 'utf-8')

  await writeFile(summaryPath(artifacts, 'goal'), `# Goal\n\n${options.goal}\n`, 'utf-8')
  await writeFile(summaryPath(artifacts, 'plan'), '# Plan\n\nPlan not available yet.\n', 'utf-8')
  await writeFile(summaryPath(artifacts, 'open-issues'), '# Open Issues\n\n- None yet.\n', 'utf-8')
  await writeFile(summaryPath(artifacts, 'evidence'), '# Evidence\n\n- No evidence recorded yet.\n', 'utf-8')
  await writeFile(artifacts.knowledgeStatePath, `${JSON.stringify(toKnowledgeState({
    currentStage: 'queued',
    lastReliableResult: 'Knowledge scaffold created.',
    nextAction: 'Generate or update the task plan.',
    currentBlocker: 'Waiting for the first stage result.',
  }), null, 2)}\n`, 'utf-8')
  await writeFile(artifacts.knowledgeCandidatesPath, '[]\n', 'utf-8')
  await writeFile(artifacts.knowledgeLogPath, '# Task Knowledge Log\n\n', 'utf-8')

  await appendLog(
    artifacts,
    `[${new Date().toISOString()}] create | ${options.capability}:${options.sessionId}`,
    `- Title: ${options.title}\n- Goal: ${options.goal}`
  )
  await rebuildIndex(artifacts)

  return artifacts
}

export async function updateTaskKnowledgeState(
  artifacts: KnowledgeArtifacts,
  state: Partial<KnowledgeState>,
  logMessage?: string
): Promise<void> {
  const current = await readKnowledgeState(artifacts)
  const next = toKnowledgeState(state, current || undefined)
  await writeFile(artifacts.knowledgeStatePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  if (logMessage) {
    await appendLog(
      artifacts,
      `[${new Date().toISOString()}] update | state`,
      `- ${logMessage}`
    )
  }
}

export async function updateTaskKnowledgeSummary(
  artifacts: KnowledgeArtifacts,
  name: string,
  content: string,
  logMessage?: string
): Promise<void> {
  await mkdir(artifacts.knowledgeSummaryDir, { recursive: true })
  await writeFile(summaryPath(artifacts, name), `${content.trim()}\n`, 'utf-8')
  await rebuildIndex(artifacts)
  if (logMessage) {
    await appendLog(
      artifacts,
      `[${new Date().toISOString()}] update | ${name}`,
      `- ${logMessage}`
    )
  }
}

export async function writeTaskKnowledgeFinal(
  artifacts: KnowledgeArtifacts,
  content: string,
  candidates: KnowledgeCandidate[],
  logMessage: string
): Promise<void> {
  await updateTaskKnowledgeSummary(artifacts, 'final', content, logMessage)
  await writeFile(artifacts.knowledgeCandidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf-8')
}

async function readKnowledgeState(artifacts: KnowledgeArtifacts): Promise<KnowledgeState | null> {
  try {
    const raw = await readFile(artifacts.knowledgeStatePath, 'utf-8')
    return toKnowledgeState(JSON.parse(raw) as Partial<KnowledgeState>)
  } catch {
    return null
  }
}

export async function readKnowledgeCandidates(artifacts: KnowledgeArtifacts): Promise<KnowledgeCandidate[]> {
  try {
    const raw = await readFile(artifacts.knowledgeCandidatesPath, 'utf-8')
    const parsed = JSON.parse(raw) as KnowledgeCandidate[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatGlobalEntry(candidate: KnowledgeCandidate): string {
  return [
    `# ${candidate.title}`,
    '',
    `Type: ${candidate.type}`,
    `Topic key: ${candidate.topicKey || candidateSlug(candidate)}`,
    `Lifecycle: ${candidate.lifecycle || 'active'}`,
    `Source session: ${candidate.sourceSessionId}`,
    candidate.evidencePath ? `Evidence: ${candidate.evidencePath}` : undefined,
    candidate.scope ? `Scope: ${candidate.scope}` : undefined,
    candidate.appliesTo && candidate.appliesTo.length > 0 ? `Applies to: ${candidate.appliesTo.join(', ')}` : undefined,
    candidate.supersededBy ? `Superseded by: ${candidate.supersededBy}` : undefined,
    candidate.introducedAt ? `Introduced at: ${candidate.introducedAt}` : undefined,
    candidate.lastUsedAt ? `Last used at: ${candidate.lastUsedAt}` : undefined,
    '',
    candidate.summary,
    '',
  ].filter(Boolean).join('\n')
}

async function readCountIndex(path: string): Promise<Record<string, number>> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeGlobalIndex(repoDir: string): Promise<void> {
  const decisionDir = join(repoDir, 'decisions')
  const failureDir = join(repoDir, 'failure-patterns')
  const workflowRuleDir = join(repoDir, 'workflow-rules')
  const decisionEntries = await listMarkdownEntries(decisionDir)
  const failureEntries = await listMarkdownEntries(failureDir)
  const workflowRuleEntries = await listMarkdownEntries(workflowRuleDir)
  const lines = [
    '# Repository Knowledge Index',
    '',
    '## Decisions',
    ...decisionEntries.map((entry) => `- ${entry}`),
    '',
    '## Failure patterns',
    ...failureEntries.map((entry) => `- ${entry}`),
    '',
    '## Workflow rules',
    ...workflowRuleEntries.map((entry) => `- ${entry}`),
    '',
  ]
  await writeFile(join(repoDir, 'index.md'), `${lines.join('\n')}\n`, 'utf-8')
}

async function listMarkdownEntries(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    const markdown = entries.filter((entry) => entry.endsWith('.md')).sort()
    const labels = await Promise.all(markdown.map(async (entry) => {
      const content = await safeRead(join(dir, entry))
      const titleLine = content.split('\n').find((line) => line.startsWith('# '))
      return titleLine ? titleLine.replace(/^#\s+/, '').trim() : entry
    }))
    return labels
  } catch {
    return []
  }
}

async function listMarkdownFileNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter((entry) => entry.endsWith('.md')).sort()
  } catch {
    return []
  }
}

async function listSummaryNames(artifacts: KnowledgeArtifacts): Promise<string[]> {
  const entries = await listMarkdownEntries(artifacts.knowledgeSummaryDir)
  return entries.map((entry) => entry.replace(/\.md$/, ''))
}

function finalizeCandidate(candidate: KnowledgeCandidate, status: KnowledgeCandidateStatus, lifecycle: KnowledgeLifecycle): KnowledgeCandidate {
  const now = new Date().toISOString()
  return {
    ...candidate,
    topicKey: candidate.topicKey || candidateSlug(candidate),
    status,
    lifecycle,
    introducedAt: candidate.introducedAt || now,
    lastUsedAt: candidate.lastUsedAt || now,
  }
}

function buildFailureIndexCandidates(
  entries: Array<{
    signature: string
    count: number
    latestReason: string
    latestEvidencePaths?: string[]
    recentSessionIds?: string[]
    selfHealCandidateCount?: number
  }>
): KnowledgeCandidate[] {
  return entries
    .filter((entry) => entry.count >= 2)
    .map((entry) => ({
      type: 'failure-pattern' as const,
      title: entry.latestReason || entry.signature,
      summary: [
        entry.latestReason || entry.signature,
        `Signature: ${entry.signature}`,
        `Count: ${entry.count}`,
        entry.selfHealCandidateCount && entry.selfHealCandidateCount > 0
          ? 'Self-repair candidate seen in failure ledger.'
          : undefined,
      ].filter(Boolean).join('\n'),
      topicKey: entry.signature,
      sourceSessionId: entry.recentSessionIds?.[entry.recentSessionIds.length - 1] || 'failure-index',
      evidencePath: entry.latestEvidencePaths?.[0],
      status: 'candidate' as const,
      lifecycle: 'active' as const,
    }))
}

export async function promoteKnowledgeCandidates(
  repoRoot: string,
  candidates: KnowledgeCandidate[]
): Promise<PromotionResult> {
  const repoKey = getProjectStorageKey(repoRoot)
  const repoDir = join(getMagpieHomeDir(), 'knowledge', repoKey)
  const decisionsDir = join(repoDir, 'decisions')
  const failuresDir = join(repoDir, 'failure-patterns')
  const workflowRulesDir = join(repoDir, 'workflow-rules')
  const failureCountPath = join(repoDir, 'failure-pattern-counts.json')
  const promoted: KnowledgeCandidate[] = []
  const deferred: KnowledgeCandidate[] = []

  await mkdir(decisionsDir, { recursive: true })
  await mkdir(failuresDir, { recursive: true })
  await mkdir(workflowRulesDir, { recursive: true })

  const failureCounts = await readCountIndex(failureCountPath)
  const failureIndexCandidates = buildFailureIndexCandidates((await readFailureIndex(repoRoot)).entries)

  for (const candidate of candidates) {
    const slug = candidateSlug(candidate)
    if (candidate.type === 'decision') {
      const promotedCandidate = finalizeCandidate(candidate, 'promoted', 'active')
      await writeFile(join(decisionsDir, `${slug}.md`), `${formatGlobalEntry(promotedCandidate)}\n`, 'utf-8')
      promoted.push(promotedCandidate)
      continue
    }

    if (candidate.type === 'workflow-rule') {
      const promotedCandidate = finalizeCandidate(candidate, 'promoted', 'active')
      await writeFile(join(workflowRulesDir, `${slug}.md`), `${formatGlobalEntry(promotedCandidate)}\n`, 'utf-8')
      promoted.push(promotedCandidate)
      continue
    }

    const countKey = candidateTopicKey(candidate)
    const nextCount = (failureCounts[countKey] || 0) + 1
    failureCounts[countKey] = nextCount
    if (nextCount < 2) {
      deferred.push(finalizeCandidate(candidate, 'deferred', 'deferred'))
      continue
    }

    const promotedCandidate = finalizeCandidate(candidate, 'promoted', 'active')
    await writeFile(join(failuresDir, `${slug}.md`), `${formatGlobalEntry(promotedCandidate)}\n`, 'utf-8')
    promoted.push(promotedCandidate)
  }

  for (const candidate of failureIndexCandidates) {
    const slug = candidateSlug(candidate)
    const promotedCandidate = finalizeCandidate(candidate, 'promoted', 'active')
    await writeFile(join(failuresDir, `${slug}.md`), `${formatGlobalEntry(promotedCandidate)}\n`, 'utf-8')
    promoted.push(promotedCandidate)
  }

  await writeFile(failureCountPath, `${JSON.stringify(failureCounts, null, 2)}\n`, 'utf-8')
  await writeGlobalIndex(repoDir)

  return { repoKey, promoted, deferred }
}

export async function promoteKnowledgeCandidatesWithMemorySync(
  repoRoot: string,
  candidates: KnowledgeCandidate[]
): Promise<PromotionResult & { memoryPath: string }> {
  const result = await promoteKnowledgeCandidates(repoRoot, candidates)
  const memoryPath = await syncProjectMemoryFromPromotedKnowledge(repoRoot, result.promoted)
  return {
    ...result,
    memoryPath,
  }
}

async function readLatestSummary(artifacts: KnowledgeArtifacts): Promise<string> {
  const stageEntries = (await listSummaryNames(artifacts))
    .filter((name) => name.startsWith('stage-'))
    .sort()
    .reverse()
  const names = ['final', ...stageEntries, ...SUMMARY_ORDER]
  for (const name of names) {
    const content = stripMarkdown(await safeRead(summaryPath(artifacts, name)))
    if (content) {
      return content
    }
  }
  return ''
}

async function loadGlobalContext(repoRoot: string): Promise<string> {
  const repoDir = join(getMagpieHomeDir(), 'knowledge', getProjectStorageKey(repoRoot))
  const index = stripMarkdown(await safeRead(join(repoDir, 'index.md')))
  const sections: string[] = []

  if (index) {
    sections.push(`Index: ${index}`)
  }

  const decisionFiles = await listMarkdownFileNames(join(repoDir, 'decisions'))
  const failureFiles = await listMarkdownFileNames(join(repoDir, 'failure-patterns'))
  const workflowRuleFiles = await listMarkdownFileNames(join(repoDir, 'workflow-rules'))

  const decisionEntries = await Promise.all(
    decisionFiles.slice(0, 3).map(async (entry) => stripMarkdown(await safeRead(join(repoDir, 'decisions', entry))))
  )
  const failureEntries = await Promise.all(
    failureFiles.slice(0, 3).map(async (entry) => stripMarkdown(await safeRead(join(repoDir, 'failure-patterns', entry))))
  )
  const workflowRuleEntries = await Promise.all(
    workflowRuleFiles.slice(0, 3).map(async (entry) => stripMarkdown(await safeRead(join(repoDir, 'workflow-rules', entry))))
  )

  if (decisionEntries.length > 0) {
    sections.push(`Decisions: ${decisionEntries.filter(Boolean).join(' | ')}`)
  }
  if (failureEntries.length > 0) {
    sections.push(`Failure patterns: ${failureEntries.filter(Boolean).join(' | ')}`)
  }
  if (workflowRuleEntries.length > 0) {
    sections.push(`Workflow rules: ${workflowRuleEntries.filter(Boolean).join(' | ')}`)
  }

  return sections.length > 0 ? `Repository knowledge:\n${sections.join('\n')}` : ''
}

export async function renderKnowledgeContext(
  artifacts: KnowledgeArtifacts,
  repoRoot: string
): Promise<string> {
  const snapshot = await loadInspectSnapshot(artifacts)
  const global = await loadGlobalContext(repoRoot)
  const memory = await loadPersistentMemoryContext(repoRoot)

  return [
    'Task knowledge context:',
    '',
    `Goal summary: ${snapshot.goal || '(missing)'}`,
    `Current stage: ${snapshot.state.currentStage || '(missing)'}`,
    `Last reliable result: ${snapshot.state.lastReliableResult || '(missing)'}`,
    `Next action: ${snapshot.state.nextAction || '(missing)'}`,
    `Current blocker: ${snapshot.state.currentBlocker || '(none)'}`,
    `Latest summary: ${snapshot.latestSummary || '(missing)'}`,
    `Open issues: ${snapshot.openIssues || '(none)'}`,
    `Evidence: ${snapshot.evidence || '(none)'}`,
    memory ? `Persistent memory:\n${memory}` : '',
    global,
  ].filter(Boolean).join('\n')
}

export async function loadInspectSnapshot(artifacts: KnowledgeArtifacts): Promise<InspectSnapshot> {
  const goal = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'goal')), 'Goal')
  const state = (await readKnowledgeState(artifacts)) || defaultKnowledgeState()
  const latestSummary = await readLatestSummary(artifacts)
  const openIssues = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'open-issues')), 'Open Issues')
  const evidence = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'evidence')), 'Evidence')
  const candidates = await readKnowledgeCandidates(artifacts)

  return {
    knowledgeDir: knowledgeDirFromArtifacts(artifacts),
    goal,
    state,
    latestSummary,
    openIssues,
    evidence,
    candidates,
  }
}

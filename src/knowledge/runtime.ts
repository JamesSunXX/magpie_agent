import { createHash } from 'crypto'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { getMagpieHomeDir } from '../platform/paths.js'

export interface KnowledgeArtifacts {
  knowledgeSchemaPath: string
  knowledgeIndexPath: string
  knowledgeLogPath: string
  knowledgeSummaryDir: string
  knowledgeCandidatesPath: string
}

export type KnowledgeCandidateType = 'decision' | 'failure-pattern'

export interface KnowledgeCandidate {
  type: KnowledgeCandidateType
  title: string
  summary: string
  sourceSessionId: string
  evidencePath?: string
  status: 'candidate' | 'promoted' | 'deferred'
}

export interface InspectSnapshot {
  knowledgeDir: string
  goal: string
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

interface PromotionResult {
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

function repoKeyFor(repoRoot: string): string {
  const name = normalizeKey(basename(resolve(repoRoot))) || 'repo'
  const digest = createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 8)
  return `${name}-${digest}`
}

function candidateSlug(candidate: KnowledgeCandidate): string {
  return normalizeKey(candidate.title) || `${candidate.type}-entry`
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
  const lines = ['# Task Knowledge Index', '', '## Core summaries']
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
    knowledgeSummaryDir,
    knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
  }

  await mkdir(knowledgeSummaryDir, { recursive: true })

  await writeFile(artifacts.knowledgeSchemaPath, [
    '# Task Knowledge Schema',
    '',
    '- Keep a concise goal summary, plan summary, open issues, evidence, stage summaries, and final summary.',
    '- Promote only stable decisions and repeated failure patterns.',
    '- Do not overwrite raw artifacts; reference them from summaries instead.',
    '',
  ].join('\n'), 'utf-8')

  await writeFile(summaryPath(artifacts, 'goal'), `# Goal\n\n${options.goal}\n`, 'utf-8')
  await writeFile(summaryPath(artifacts, 'plan'), '# Plan\n\nPlan not available yet.\n', 'utf-8')
  await writeFile(summaryPath(artifacts, 'open-issues'), '# Open Issues\n\n- None yet.\n', 'utf-8')
  await writeFile(summaryPath(artifacts, 'evidence'), '# Evidence\n\n- No evidence recorded yet.\n', 'utf-8')
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
    `Source session: ${candidate.sourceSessionId}`,
    candidate.evidencePath ? `Evidence: ${candidate.evidencePath}` : undefined,
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
  const decisionEntries = await listMarkdownEntries(decisionDir)
  const failureEntries = await listMarkdownEntries(failureDir)
  const lines = [
    '# Repository Knowledge Index',
    '',
    '## Decisions',
    ...decisionEntries.map((entry) => `- ${entry}`),
    '',
    '## Failure patterns',
    ...failureEntries.map((entry) => `- ${entry}`),
    '',
  ]
  await writeFile(join(repoDir, 'index.md'), lines.join('\n'), 'utf-8')
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

export async function promoteKnowledgeCandidates(
  repoRoot: string,
  candidates: KnowledgeCandidate[]
): Promise<PromotionResult> {
  const repoKey = repoKeyFor(repoRoot)
  const repoDir = join(getMagpieHomeDir(), 'knowledge', repoKey)
  const decisionsDir = join(repoDir, 'decisions')
  const failuresDir = join(repoDir, 'failure-patterns')
  const failureCountPath = join(repoDir, 'failure-pattern-counts.json')
  const promoted: KnowledgeCandidate[] = []
  const deferred: KnowledgeCandidate[] = []

  await mkdir(decisionsDir, { recursive: true })
  await mkdir(failuresDir, { recursive: true })

  const failureCounts = await readCountIndex(failureCountPath)

  for (const candidate of candidates) {
    const slug = candidateSlug(candidate)
    if (candidate.type === 'decision') {
      const filePath = join(decisionsDir, `${slug}.md`)
      await writeFile(filePath, formatGlobalEntry({ ...candidate, status: 'promoted' }), 'utf-8')
      promoted.push({ ...candidate, status: 'promoted' })
      continue
    }

    const nextCount = (failureCounts[slug] || 0) + 1
    failureCounts[slug] = nextCount
    if (nextCount < 2) {
      deferred.push({ ...candidate, status: 'deferred' })
      continue
    }

    const filePath = join(failuresDir, `${slug}.md`)
    await writeFile(filePath, formatGlobalEntry({ ...candidate, status: 'promoted' }), 'utf-8')
    promoted.push({ ...candidate, status: 'promoted' })
  }

  await writeFile(failureCountPath, `${JSON.stringify(failureCounts, null, 2)}\n`, 'utf-8')
  await writeGlobalIndex(repoDir)

  return { repoKey, promoted, deferred }
}

async function readLatestSummary(artifacts: KnowledgeArtifacts): Promise<string> {
  const stageEntries = (await listSummaryNames(artifacts))
    .filter((name) => name.startsWith('stage-'))
    .sort()
    .reverse()
  const candidates = ['final', ...stageEntries, ...SUMMARY_ORDER]
  for (const name of candidates) {
    const content = stripMarkdown(await safeRead(summaryPath(artifacts, name)))
    if (content) {
      return content
    }
  }
  return ''
}

async function loadGlobalContext(repoRoot: string): Promise<string> {
  const repoDir = join(getMagpieHomeDir(), 'knowledge', repoKeyFor(repoRoot))
  const index = stripMarkdown(await safeRead(join(repoDir, 'index.md')))
  const sections: string[] = []

  if (index) {
    sections.push(`Index: ${index}`)
  }

  const decisionFiles = await listMarkdownFileNames(join(repoDir, 'decisions'))
  const failureFiles = await listMarkdownFileNames(join(repoDir, 'failure-patterns'))
  const decisionEntries = await Promise.all(
    decisionFiles.slice(0, 3).map(async (entry) => stripMarkdown(await safeRead(join(repoDir, 'decisions', entry))))
  )
  const failureEntries = await Promise.all(
    failureFiles.slice(0, 3).map(async (entry) => stripMarkdown(await safeRead(join(repoDir, 'failure-patterns', entry))))
  )

  if (decisionEntries.length > 0) {
    sections.push(`Decisions: ${decisionEntries.filter(Boolean).join(' | ')}`)
  }
  if (failureEntries.length > 0) {
    sections.push(`Failure patterns: ${failureEntries.filter(Boolean).join(' | ')}`)
  }

  return sections.length > 0 ? `Repository knowledge:\n${sections.join('\n')}` : ''
}

export async function renderKnowledgeContext(
  artifacts: KnowledgeArtifacts,
  repoRoot: string
): Promise<string> {
  const snapshot = await loadInspectSnapshot(artifacts)
  const global = await loadGlobalContext(repoRoot)

  return [
    'Task knowledge context:',
    '',
    `Goal summary: ${snapshot.goal || '(missing)'}`,
    `Latest summary: ${snapshot.latestSummary || '(missing)'}`,
    `Open issues: ${snapshot.openIssues || '(none)'}`,
    `Evidence: ${snapshot.evidence || '(none)'}`,
    global,
  ].filter(Boolean).join('\n')
}

export async function loadInspectSnapshot(artifacts: KnowledgeArtifacts): Promise<InspectSnapshot> {
  const goal = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'goal')), 'Goal')
  const latestSummary = await readLatestSummary(artifacts)
  const openIssues = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'open-issues')), 'Open Issues')
  const evidence = removeLeadingLabel(await safeRead(summaryPath(artifacts, 'evidence')), 'Evidence')
  const candidates = await readKnowledgeCandidates(artifacts)

  return {
    knowledgeDir: knowledgeDirFromArtifacts(artifacts),
    goal,
    latestSummary,
    openIssues,
    evidence,
    candidates,
  }
}

import { existsSync } from 'fs'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, join, relative, resolve, sep } from 'path'
import type { AIProvider, ChatOptions, Message } from '../../platform/providers/index.js'
import { getRepoRoot } from '../../platform/paths.js'
import { extractJsonBlock } from '../../trd/renderer.js'

const FORMAL_DOC_TYPES = ['prd', 'story', 'trd', 'api_design', 'task', 'feature_plan'] as const
const PROCESS_ARTIFACT_STAGES = new Set([
  'prd_review',
  'domain_partition',
  'domain_overview',
  'synthesis',
  'constraint_check',
  'verification',
  'code_development',
  'unit_mock_test',
  'integration_test',
])
const PROCESS_ARTIFACT_PATTERNS = [
  /-draft\./i,
  /-checkpoint\./i,
  /-evidence\./i,
  /-report\./i,
]
const DEFAULT_FORMAL_DOC_NAMES: Record<FormalDocType, string> = {
  prd: 'prd.md',
  story: 'story.md',
  trd: 'trd.md',
  api_design: 'api-design.md',
  task: 'task.md',
  feature_plan: 'feature-plan.md',
}
const STAGE_TO_FORMAL_DOC_TYPE: Partial<Record<string, FormalDocType>> = {
  trd_generation: 'trd',
}
const MIN_PROJECT_DOC_CONFIDENCE = 0.6

export type FormalDocType = typeof FORMAL_DOC_TYPES[number]
export type DocumentPlanMode = 'project_docs' | 'fallback'
export type ArtifactKind = 'formal' | 'process'

export interface DocumentPlan {
  mode: DocumentPlanMode
  reasoningSources: string[]
  formalDocsRoot: string
  formalDocTargets: Partial<Record<FormalDocType, string>>
  artifactPolicy: {
    processArtifactsRoot: string
    fallbackFormalDocsRoot: string
  }
  confidence: number
  fallbackReason?: string
}

interface DocumentPlanJson {
  mode?: DocumentPlanMode
  reasoningSources?: unknown
  formalDocsRoot?: string
  formalDocTargets?: Record<string, string>
  confidence?: number
  fallbackReason?: string
}

interface DocumentPlanIdentity {
  repoRoot: string
  capability: 'loop' | 'harness'
  sessionId: string
}

interface GenerateDocumentPlanOptions extends DocumentPlanIdentity {
  sessionDir: string
  goal: string
  prdPath: string
  stages: string[]
  provider?: AIProvider
  seedPlan?: DocumentPlan | null
  existingPlanPath?: string
}

function clampConfidence(value: number | undefined): number {
  const next = Number.isFinite(value) ? Number(value) : 0
  return Math.max(0, Math.min(1, next))
}

function fallbackFormalDocsRoot(repoRoot: string, sessionId: string): string {
  return join(repoRoot, '.magpie', 'project-docs', sessionId)
}

function fallbackFormalDocTargets(repoRoot: string, sessionId: string): Partial<Record<FormalDocType, string>> {
  const root = fallbackFormalDocsRoot(repoRoot, sessionId)
  return FORMAL_DOC_TYPES.reduce<Partial<Record<FormalDocType, string>>>((acc, type) => {
    acc[type] = join(root, DEFAULT_FORMAL_DOC_NAMES[type])
    return acc
  }, {})
}

function normalizePath(repoRoot: string, target: string | undefined): string {
  if (!target) return ''
  return resolve(repoRoot, target)
}

function isInside(parent: string, target: string): boolean {
  const rel = relative(parent, target)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('../'))
}

function normalizeReasoningSources(repoRoot: string, raw: unknown): string[] {
  return normalizeReasoningSourcesForRepo(repoRoot, raw)
}

function normalizeReasoningSourcesForRepo(
  repoRoot: string,
  raw: unknown,
  sourceRepoRoot?: string | null
): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => normalizePlanPath(repoRoot, item, sourceRepoRoot))
}

function docsRoot(repoRoot: string): string {
  return join(repoRoot, 'docs')
}

function templatesRoot(repoRoot: string): string {
  return join(repoRoot, 'docs', 'templates')
}

function isApprovedFormalDocsPath(target: string, repoRoot: string): boolean {
  const docsDir = docsRoot(repoRoot)
  return target !== docsDir && isInside(docsDir, target)
}

function fallbackBecause(
  reason: string,
  identity: DocumentPlanIdentity,
  confidence = 0
): DocumentPlan {
  return {
    ...createFallbackDocumentPlan(identity),
    confidence: clampConfidence(confidence),
    fallbackReason: reason,
  }
}

function normalizeFormalDocTargets(
  repoRoot: string,
  rawTargets: Record<string, string> | undefined,
  sourceRepoRoot?: string | null
): Partial<Record<FormalDocType, string>> {
  const targets: Partial<Record<FormalDocType, string>> = {}
  for (const type of FORMAL_DOC_TYPES) {
    const value = rawTargets?.[type]
    if (typeof value === 'string' && value.trim().length > 0) {
      targets[type] = normalizePlanPath(repoRoot, value, sourceRepoRoot)
    }
  }
  return targets
}

function hasInvalidFormalTarget(target: string, repoRoot: string): string | null {
  if (!isInside(repoRoot, target)) {
    return `Formal document target is outside the repository: ${target}`
  }

  if (target === docsRoot(repoRoot)) {
    return `Formal document target points at docs root: ${target}`
  }

  if (!isApprovedFormalDocsPath(target, repoRoot)) {
    return `Formal document target is outside an approved document directory: ${target}`
  }

  const templatesDir = templatesRoot(repoRoot)
  if (target === templatesDir || isInside(templatesDir, target)) {
    return `Formal document target points at docs/templates: ${target}`
  }

  return null
}

function deriveRepoRootFromPolicyRoot(root: string | undefined, marker: string): string | null {
  if (!root || root.trim().length === 0) {
    return null
  }

  const normalized = resolve(root)
  const pivot = `${sep}.magpie${sep}${marker}${sep}`
  const markerIndex = normalized.lastIndexOf(pivot)
  if (markerIndex <= 0) {
    return null
  }
  return normalized.slice(0, markerIndex)
}

function deriveDocumentPlanSourceRepoRoot(input: DocumentPlan): string | null {
  return deriveRepoRootFromPolicyRoot(input.artifactPolicy?.processArtifactsRoot, 'sessions')
    || deriveRepoRootFromPolicyRoot(input.artifactPolicy?.fallbackFormalDocsRoot, 'project-docs')
}

function normalizePlanPath(
  repoRoot: string,
  target: string | undefined,
  sourceRepoRoot?: string | null
): string {
  if (!target) return ''

  const sourceBase = sourceRepoRoot || repoRoot
  const normalized = resolve(sourceBase, target)
  if (!sourceRepoRoot || sourceRepoRoot === repoRoot || !isInside(sourceRepoRoot, normalized)) {
    return normalized
  }

  return resolve(repoRoot, relative(sourceRepoRoot, normalized))
}

export function createFallbackDocumentPlan(identity: DocumentPlanIdentity): DocumentPlan {
  const fallbackRoot = fallbackFormalDocsRoot(identity.repoRoot, identity.sessionId)
  return {
    mode: 'fallback',
    reasoningSources: [],
    formalDocsRoot: fallbackRoot,
    formalDocTargets: fallbackFormalDocTargets(identity.repoRoot, identity.sessionId),
    artifactPolicy: {
      processArtifactsRoot: join(identity.repoRoot, '.magpie', 'sessions', identity.capability, identity.sessionId),
      fallbackFormalDocsRoot: fallbackRoot,
    },
    confidence: 0,
    fallbackReason: 'No validated project document target was available.',
  }
}

export function validateDocumentPlan(
  input: DocumentPlan,
  identity: DocumentPlanIdentity
): DocumentPlan {
  const confidence = clampConfidence(input.confidence)
  const sourceRepoRoot = deriveDocumentPlanSourceRepoRoot(input)
  const reasoningSources = normalizeReasoningSourcesForRepo(identity.repoRoot, input.reasoningSources, sourceRepoRoot)
  const processArtifactsRoot = join(identity.repoRoot, '.magpie', 'sessions', identity.capability, identity.sessionId)
  const fallbackRoot = fallbackFormalDocsRoot(identity.repoRoot, identity.sessionId)

  if (input.mode !== 'project_docs') {
    return {
      ...fallbackBecause(input.fallbackReason || 'Project document mode was not selected.', identity, confidence),
      reasoningSources,
      artifactPolicy: {
        processArtifactsRoot,
        fallbackFormalDocsRoot: fallbackRoot,
      },
    }
  }

  if (confidence < MIN_PROJECT_DOC_CONFIDENCE) {
    return {
      ...fallbackBecause(`Model confidence ${confidence.toFixed(2)} is below ${MIN_PROJECT_DOC_CONFIDENCE.toFixed(2)}.`, identity, confidence),
      reasoningSources,
      artifactPolicy: {
        processArtifactsRoot,
        fallbackFormalDocsRoot: fallbackRoot,
      },
    }
  }

  const normalizedRoot = normalizePlanPath(identity.repoRoot, input.formalDocsRoot, sourceRepoRoot)
  const rootFailure = hasInvalidFormalTarget(normalizedRoot, identity.repoRoot)
  if (rootFailure) {
    return {
      ...fallbackBecause(rootFailure, identity, confidence),
      reasoningSources,
      artifactPolicy: {
        processArtifactsRoot,
        fallbackFormalDocsRoot: fallbackRoot,
      },
    }
  }

  const targets = normalizeFormalDocTargets(identity.repoRoot, input.formalDocTargets, sourceRepoRoot)
  const targetValues = Object.values(targets)
  if (targetValues.length === 0) {
    return {
      ...fallbackBecause('No formal document targets were validated for project document mode.', identity, confidence),
      reasoningSources,
      artifactPolicy: {
        processArtifactsRoot,
        fallbackFormalDocsRoot: fallbackRoot,
      },
    }
  }

  for (const target of targetValues) {
    const failure = hasInvalidFormalTarget(target, identity.repoRoot)
    if (failure) {
      return {
        ...fallbackBecause(failure, identity, confidence),
        reasoningSources,
        artifactPolicy: {
          processArtifactsRoot,
          fallbackFormalDocsRoot: fallbackRoot,
        },
      }
    }
  }

  return {
    mode: 'project_docs',
    reasoningSources,
    formalDocsRoot: normalizedRoot,
    formalDocTargets: targets,
    artifactPolicy: {
      processArtifactsRoot,
      fallbackFormalDocsRoot: fallbackRoot,
    },
    confidence,
  }
}

async function listDirectoryTree(root: string, maxDepth = 2, currentDepth = 0): Promise<string[]> {
  if (!existsSync(root) || currentDepth > maxDepth) {
    return []
  }

  const entries = await readdir(root, { withFileTypes: true })
  const lines: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`${'  '.repeat(currentDepth)}- ${entry.name}${entry.isDirectory() ? '/' : ''}`)
    if (entry.isDirectory()) {
      lines.push(...await listDirectoryTree(join(root, entry.name), maxDepth, currentDepth + 1))
    }
  }
  return lines
}

async function findProjectRuleFiles(repoRoot: string): Promise<string[]> {
  const staticCandidates = [
    'AGENTS.md',
    'ARCHITECTURE.md',
    'docs/README.md',
    'docs/review.md',
    'docs/references/capabilities.md',
  ].map((item) => join(repoRoot, item)).filter((item) => existsSync(item))

  for (const folder of [join(repoRoot, 'docs', 'rules'), join(repoRoot, 'docs', 'templates')]) {
    if (!existsSync(folder)) {
      continue
    }
    const entries = await readdir(folder, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        staticCandidates.push(join(folder, entry.name))
      }
    }
  }

  return staticCandidates
}

async function readContextSnippet(path: string, repoRoot: string): Promise<string> {
  const content = await readFile(path, 'utf-8').catch(() => '')
  if (!content) {
    return ''
  }
  const label = relative(repoRoot, path) || basename(path)
  return `## ${label}\n${content.slice(0, 4000).trim()}`
}

async function buildProjectContext(repoRoot: string): Promise<{
  reasoningSources: string[]
  promptContext: string
}> {
  const reasoningSources = await findProjectRuleFiles(repoRoot)
  const sourceBlocks = (await Promise.all(
    reasoningSources.map((item) => readContextSnippet(item, repoRoot))
  )).filter(Boolean)
  const docsTree = await listDirectoryTree(join(repoRoot, 'docs'))

  return {
    reasoningSources,
    promptContext: [
      sourceBlocks.join('\n\n'),
      docsTree.length > 0 ? `## docs tree\n${docsTree.join('\n')}` : '## docs tree\n(no docs directory found)',
    ].filter(Boolean).join('\n\n'),
  }
}

function buildDocumentPlanPrompt(
  repoRoot: string,
  goal: string,
  prdPath: string,
  stages: string[],
  context: string,
  fallbackRoot: string
): string {
  return [
    'Plan project document routing for this Magpie session.',
    '',
    `Repository root: ${repoRoot}`,
    `Goal: ${goal}`,
    `PRD path: ${prdPath}`,
    `Stages: ${stages.join(', ')}`,
    '',
    'Requirements:',
    '- Decide whether project-specific document mode is safe to use.',
    '- Formal documents may only use stable project documentation locations.',
    '- Process artifacts, reports, evidence, checkpoints, and stage summaries must stay under the session directory, never in project docs.',
    '- If you are not confident, choose fallback mode.',
    `- Fallback formal docs root: ${fallbackRoot}`,
    '',
    context,
    '',
    'Return ONLY JSON:',
    '```json',
    '{',
    '  "mode": "project_docs|fallback",',
    '  "reasoningSources": ["absolute/path/to/rule.md"],',
    '  "formalDocsRoot": "/absolute/path/to/docs/root",',
    '  "formalDocTargets": {',
    '    "trd": "/absolute/path/to/trd.md"',
    '  },',
    '  "confidence": 0.0,',
    '  "fallbackReason": "..."',
    '}',
    '```',
  ].join('\n')
}

function toDocumentPlan(parsed: DocumentPlanJson | null, identity: DocumentPlanIdentity): DocumentPlan {
  if (!parsed) {
    return fallbackBecause('Document planner did not return valid JSON.', identity)
  }

  return validateDocumentPlan({
    mode: parsed.mode === 'project_docs' ? 'project_docs' : 'fallback',
    reasoningSources: normalizeReasoningSources(identity.repoRoot, parsed.reasoningSources),
    formalDocsRoot: normalizePath(identity.repoRoot, parsed.formalDocsRoot),
    formalDocTargets: normalizeFormalDocTargets(identity.repoRoot, parsed.formalDocTargets),
    artifactPolicy: {
      processArtifactsRoot: join(identity.repoRoot, '.magpie', 'sessions', identity.capability, identity.sessionId),
      fallbackFormalDocsRoot: fallbackFormalDocsRoot(identity.repoRoot, identity.sessionId),
    },
    confidence: clampConfidence(parsed.confidence),
    fallbackReason: parsed.fallbackReason,
  }, identity)
}

export async function loadDocumentPlan(path: string): Promise<DocumentPlan | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as DocumentPlan
  } catch {
    return null
  }
}

export async function generateDocumentPlan(options: GenerateDocumentPlanOptions): Promise<{
  plan: DocumentPlan
  planPath: string
}> {
  const repoRoot = getRepoRoot(options.repoRoot)
  const identity: DocumentPlanIdentity = {
    repoRoot,
    capability: options.capability,
    sessionId: options.sessionId,
  }
  const planPath = join(options.sessionDir, 'document-plan.json')
  const persistedPath = options.existingPlanPath || planPath

  if (options.seedPlan) {
    const validated = validateDocumentPlan(options.seedPlan, identity)
    await mkdir(options.sessionDir, { recursive: true })
    await writeFile(planPath, JSON.stringify(validated, null, 2), 'utf-8')
    return { plan: validated, planPath }
  }

  const existing = await loadDocumentPlan(persistedPath)
  if (existing) {
    const validated = validateDocumentPlan(existing, identity)
    await mkdir(options.sessionDir, { recursive: true })
    await writeFile(planPath, JSON.stringify(validated, null, 2), 'utf-8')
    return { plan: validated, planPath }
  }

  let nextPlan = createFallbackDocumentPlan(identity)
  if (options.provider) {
    try {
      const context = await buildProjectContext(repoRoot)
      const messages: Message[] = [{
        role: 'user',
        content: buildDocumentPlanPrompt(
          repoRoot,
          options.goal,
          resolve(options.prdPath),
          options.stages,
          context.promptContext,
          fallbackFormalDocsRoot(repoRoot, options.sessionId)
        ),
      }]
      const chatOptions: ChatOptions = { disableTools: true }
      const raw = await options.provider.chat(messages, undefined, chatOptions)
      const parsed = extractJsonBlock<DocumentPlanJson>(raw)
      nextPlan = toDocumentPlan(parsed, identity)
      nextPlan.reasoningSources = nextPlan.reasoningSources.length > 0
        ? nextPlan.reasoningSources
        : context.reasoningSources
    } catch (error) {
      nextPlan = fallbackBecause(error instanceof Error ? error.message : String(error), identity)
    }
  }

  await mkdir(options.sessionDir, { recursive: true })
  await writeFile(planPath, JSON.stringify(nextPlan, null, 2), 'utf-8')
  return { plan: nextPlan, planPath }
}

export function resolveFormalDocTargetForStage(
  stage: string,
  plan: DocumentPlan
): { type: FormalDocType; path: string } | null {
  const docType = STAGE_TO_FORMAL_DOC_TYPE[stage]
  if (!docType) {
    return null
  }

  const targetPath = plan.formalDocTargets[docType]
  return targetPath ? { type: docType, path: targetPath } : null
}

export function classifyArtifact(
  stage: string,
  fileName: string,
  plan: DocumentPlan
): ArtifactKind {
  if (PROCESS_ARTIFACT_STAGES.has(stage)) {
    return 'process'
  }
  if (PROCESS_ARTIFACT_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return 'process'
  }
  return resolveFormalDocTargetForStage(stage, plan) ? 'formal' : 'process'
}

export function renderDocumentPlanForStage(stage: string, plan: DocumentPlan): string {
  const target = resolveFormalDocTargetForStage(stage, plan)
  const lines = [
    'Document routing:',
    `- Mode: ${plan.mode}`,
    `- Formal docs root: ${plan.formalDocsRoot}`,
    `- Session artifacts root: ${plan.artifactPolicy.processArtifactsRoot}`,
    '- Reports, evidence, checkpoints, drafts, and summaries must stay under the session artifacts root.',
  ]

  if (target) {
    lines.push(`- This stage may write one formal ${target.type} document to: ${target.path}`)
    lines.push('- If you create that formal document, write the full document to the approved target path and mention it under "Artifacts".')
    lines.push('- Keep your response concise; do not dump the full formal document into the stage report.')
  } else {
    lines.push('- This stage must not write anything into the project docs area. Keep generated markdown under the session artifacts root unless a repository rule explicitly requires another code-path output.')
  }

  if (plan.mode === 'fallback') {
    lines.push(`- Because project-specific placement was not trusted, any formal document must use the fallback root above. Reason: ${plan.fallbackReason || 'unspecified'}`)
  }

  return lines.join('\n')
}

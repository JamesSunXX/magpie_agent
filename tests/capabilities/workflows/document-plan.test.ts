import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  classifyArtifact,
  createFallbackDocumentPlan,
  generateDocumentPlan,
  renderDocumentPlanForStage,
  resolveFormalDocTargetForStage,
  validateDocumentPlan,
  type DocumentPlan,
} from '../../../src/core/project-documents/document-plan.js'

function createPlanRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(root, 'docs', 'guides'), { recursive: true })
  writeFileSync(join(root, 'AGENTS.md'), '# Agents', 'utf-8')
  writeFileSync(join(root, 'docs', 'README.md'), '# Docs', 'utf-8')
  return root
}

describe('document plan', () => {
  it('forces process stages to stay as process artifacts', () => {
    const plan = createFallbackDocumentPlan({
      repoRoot: '/repo',
      capability: 'loop',
      sessionId: 'loop-123',
    })

    expect(classifyArtifact('prd_review', 'prd_review.md', plan)).toBe('process')
    expect(classifyArtifact('domain_partition', 'domain_partition.md', plan)).toBe('process')
    expect(classifyArtifact('trd_generation', 'checkpoint-report.md', plan)).toBe('process')
  })

  it('falls back when the project docs root points at docs/templates', () => {
    const repoRoot = createPlanRoot('magpie-document-plan-invalid-')
    mkdirSync(join(repoRoot, 'docs', 'templates'), { recursive: true })

    const plan: DocumentPlan = {
      mode: 'project_docs',
      reasoningSources: [join(repoRoot, 'AGENTS.md')],
      formalDocsRoot: join(repoRoot, 'docs', 'templates'),
      formalDocTargets: {
        trd: join(repoRoot, 'docs', 'templates', 'feature-trd.md'),
      },
      artifactPolicy: {
        processArtifactsRoot: join(repoRoot, '.magpie', 'sessions', 'loop', 'loop-123'),
        fallbackFormalDocsRoot: join(repoRoot, '.magpie', 'project-docs', 'loop-123'),
      },
      confidence: 0.92,
    }

    const validated = validateDocumentPlan(plan, {
      repoRoot,
      capability: 'loop',
      sessionId: 'loop-123',
    })

    expect(validated.mode).toBe('fallback')
    expect(validated.formalDocsRoot).toBe(join(repoRoot, '.magpie', 'project-docs', 'loop-123'))
    expect(validated.fallbackReason).toContain('templates')
  })

  it('falls back when project document mode points outside approved docs directories', () => {
    const repoRoot = createPlanRoot('magpie-document-plan-outside-docs-')
    mkdirSync(join(repoRoot, 'src', 'generated'), { recursive: true })

    const plan: DocumentPlan = {
      mode: 'project_docs',
      reasoningSources: [join(repoRoot, 'AGENTS.md')],
      formalDocsRoot: join(repoRoot, 'src', 'generated'),
      formalDocTargets: {
        trd: join(repoRoot, 'src', 'generated', 'checkout-trd.md'),
      },
      artifactPolicy: {
        processArtifactsRoot: join(repoRoot, '.magpie', 'sessions', 'loop', 'loop-123'),
        fallbackFormalDocsRoot: join(repoRoot, '.magpie', 'project-docs', 'loop-123'),
      },
      confidence: 0.92,
    }

    const validated = validateDocumentPlan(plan, {
      repoRoot,
      capability: 'loop',
      sessionId: 'loop-123',
    })

    expect(validated.mode).toBe('fallback')
    expect(validated.formalDocsRoot).toBe(join(repoRoot, '.magpie', 'project-docs', 'loop-123'))
    expect(validated.fallbackReason).toContain('approved document directory')
  })

  it('falls back when the model reports low confidence', async () => {
    const repoRoot = createPlanRoot('magpie-document-plan-low-confidence-')
    const sessionDir = join(repoRoot, '.magpie', 'sessions', 'loop', 'loop-123')
    mkdirSync(sessionDir, { recursive: true })

    const provider = {
      name: 'mock-planner',
      chat: async () => `\`\`\`json
{
  "mode": "project_docs",
  "reasoningSources": ["${join(repoRoot, 'AGENTS.md')}"],
  "formalDocsRoot": "${join(repoRoot, 'docs', 'guides')}",
  "formalDocTargets": {
    "trd": "${join(repoRoot, 'docs', 'guides', 'feature-trd.md')}"
  },
  "confidence": 0.2
}
\`\`\``,
      chatStream: async function * () {},
    }

    const result = await generateDocumentPlan({
      repoRoot,
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-123',
      goal: 'Ship checkout safely',
      prdPath: join(repoRoot, 'docs', 'sample-prd.md'),
      stages: ['prd_review', 'trd_generation'],
      provider,
    })

    expect(result.plan.mode).toBe('fallback')
    expect(result.planPath).toBe(join(sessionDir, 'document-plan.json'))
    expect(result.plan.formalDocTargets.trd).toBe(join(result.plan.formalDocsRoot, 'trd.md'))
  })

  it('reuses an existing document plan and exposes formal stage targets', async () => {
    const repoRoot = createPlanRoot('magpie-document-plan-existing-')
    const sessionDir = join(repoRoot, '.magpie', 'sessions', 'loop', 'loop-456')
    mkdirSync(sessionDir, { recursive: true })

    const existingPlan: DocumentPlan = {
      mode: 'project_docs',
      reasoningSources: ['AGENTS.md'],
      formalDocsRoot: 'docs/guides',
      formalDocTargets: {
        trd: 'docs/guides/checkout-trd.md',
      },
      artifactPolicy: {
        processArtifactsRoot: sessionDir,
        fallbackFormalDocsRoot: join(repoRoot, '.magpie', 'project-docs', 'loop-456'),
      },
      confidence: 0.91,
    }
    writeFileSync(join(sessionDir, 'document-plan.json'), JSON.stringify(existingPlan, null, 2), 'utf-8')

    const result = await generateDocumentPlan({
      repoRoot,
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-456',
      goal: 'Keep checkout docs aligned',
      prdPath: join(repoRoot, 'docs', 'sample-prd.md'),
      stages: ['trd_generation'],
    })

    expect(result.plan.mode).toBe('project_docs')
    expect(resolveFormalDocTargetForStage('trd_generation', result.plan)).toEqual({
      type: 'trd',
      path: join(result.plan.formalDocsRoot, 'checkout-trd.md'),
    })
    expect(renderDocumentPlanForStage('trd_generation', result.plan)).toContain('This stage may write one formal trd document')
  })

  it('recomputes artifact roots and remaps project docs for a new loop workspace', () => {
    const repoRoot = createPlanRoot('magpie-document-plan-remap-')
    const worktreeRoot = join(repoRoot, '.worktrees', 'loop-789')
    mkdirSync(join(worktreeRoot, 'docs', 'guides'), { recursive: true })
    writeFileSync(join(worktreeRoot, 'AGENTS.md'), '# Agents', 'utf-8')

    const seededPlan: DocumentPlan = {
      mode: 'project_docs',
      reasoningSources: [join(repoRoot, 'AGENTS.md')],
      formalDocsRoot: join(repoRoot, 'docs', 'guides'),
      formalDocTargets: {
        trd: join(repoRoot, 'docs', 'guides', 'checkout-trd.md'),
      },
      artifactPolicy: {
        processArtifactsRoot: join(repoRoot, '.magpie', 'sessions', 'harness', 'harness-123'),
        fallbackFormalDocsRoot: join(repoRoot, '.magpie', 'project-docs', 'harness-123'),
      },
      confidence: 0.91,
    }

    const validated = validateDocumentPlan(seededPlan, {
      repoRoot: worktreeRoot,
      capability: 'loop',
      sessionId: 'loop-789',
    })

    expect(validated.mode).toBe('project_docs')
    expect(validated.reasoningSources).toEqual([join(worktreeRoot, 'AGENTS.md')])
    expect(validated.formalDocsRoot).toBe(join(worktreeRoot, 'docs', 'guides'))
    expect(validated.formalDocTargets.trd).toBe(join(worktreeRoot, 'docs', 'guides', 'checkout-trd.md'))
    expect(validated.artifactPolicy.processArtifactsRoot).toBe(
      join(worktreeRoot, '.magpie', 'sessions', 'loop', 'loop-789')
    )
    expect(validated.artifactPolicy.fallbackFormalDocsRoot).toBe(
      join(worktreeRoot, '.magpie', 'project-docs', 'loop-789')
    )
  })
})

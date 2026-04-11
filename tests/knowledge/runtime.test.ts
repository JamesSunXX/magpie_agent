import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTaskKnowledge,
  loadInspectSnapshot,
  promoteKnowledgeCandidates,
  renderKnowledgeContext,
  updateTaskKnowledgeSummary,
  type KnowledgeCandidate,
} from '../../src/knowledge/runtime.js'

describe('knowledge runtime', () => {
  let magpieHome: string | undefined

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('creates the task knowledge scaffold and renders inspect snapshots', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-home-'))
    process.env.MAGPIE_HOME = magpieHome

    const sessionDir = mkdtempSync(join(tmpdir(), 'magpie-knowledge-session-'))
    const artifacts = await createTaskKnowledge({
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-123',
      title: 'Checkout delivery',
      goal: 'Ship checkout v2 safely',
    })

    await updateTaskKnowledgeSummary(artifacts, 'plan', 'Plan summary body', 'Plan summary updated.')
    await updateTaskKnowledgeSummary(artifacts, 'open-issues', '- Waiting for migration rollback plan', 'Open issues updated.')
    await updateTaskKnowledgeSummary(artifacts, 'evidence', '- See /tmp/evidence.log', 'Evidence updated.')
    await updateTaskKnowledgeSummary(artifacts, 'stage-prd-review', 'Latest stage summary', 'Stage summary updated.')

    const inspect = await loadInspectSnapshot(artifacts)
    const promptContext = await renderKnowledgeContext(artifacts, process.cwd())

    expect(readFileSync(artifacts.knowledgeSchemaPath, 'utf-8')).toContain('# Task Knowledge Schema')
    expect(readFileSync(artifacts.knowledgeIndexPath, 'utf-8')).toContain('stage-prd-review.md')
    expect(inspect.goal).toContain('Ship checkout v2 safely')
    expect(inspect.latestSummary).toContain('Latest stage summary')
    expect(inspect.openIssues).toContain('migration rollback plan')
    expect(inspect.evidence).toContain('/tmp/evidence.log')
    expect(promptContext).toContain('Goal summary')
    expect(promptContext).toContain('Latest stage summary')
  })

  it('promotes decisions immediately and failure patterns only on the second occurrence', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-promote-'))
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = join(tmpdir(), 'magpie-knowledge-repo')
    const decision: KnowledgeCandidate = {
      type: 'decision',
      title: 'Prefer explicit harness inspect output',
      summary: 'Expose the current goal, latest summary, and knowledge path.',
      sourceSessionId: 'harness-1',
      evidencePath: '/tmp/final.md',
      status: 'candidate',
    }
    const failure: KnowledgeCandidate = {
      type: 'failure-pattern',
      title: 'review-cycle-timeout',
      summary: 'Review cycle timed out before adjudication completed.',
      sourceSessionId: 'harness-1',
      evidencePath: '/tmp/events.jsonl',
      status: 'candidate',
    }

    const first = await promoteKnowledgeCandidates(repoRoot, [decision, failure])
    const second = await promoteKnowledgeCandidates(repoRoot, [failure])

    const knowledgeRoot = join(magpieHome, 'knowledge')
    const indexPath = join(knowledgeRoot, first.repoKey, 'index.md')
    const decisionDir = join(knowledgeRoot, first.repoKey, 'decisions')
    const failureDir = join(knowledgeRoot, first.repoKey, 'failure-patterns')

    expect(first.promoted.map((item) => item.type)).toContain('decision')
    expect(first.promoted.map((item) => item.type)).not.toContain('failure-pattern')
    expect(second.promoted.map((item) => item.type)).toContain('failure-pattern')
    expect(readFileSync(indexPath, 'utf-8')).toContain('Prefer explicit harness inspect output')
    expect(readFileSync(indexPath, 'utf-8')).toContain('review-cycle-timeout')
    expect(() => readFileSync(join(decisionDir, 'prefer-explicit-harness-inspect-output.md'), 'utf-8')).not.toThrow()
    expect(() => readFileSync(join(failureDir, 'review-cycle-timeout.md'), 'utf-8')).not.toThrow()
  })

  it('includes promoted knowledge summaries in rendered context', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-context-'))
    process.env.MAGPIE_HOME = magpieHome

    const sessionDir = mkdtempSync(join(tmpdir(), 'magpie-knowledge-session-'))
    const repoRoot = join(tmpdir(), 'magpie-knowledge-repo-context')
    const artifacts = await createTaskKnowledge({
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-456',
      title: 'Checkout delivery',
      goal: 'Ship checkout v3 safely',
    })

    await promoteKnowledgeCandidates(repoRoot, [{
      type: 'decision',
      title: 'Deliver checkout v2',
      summary: 'Prefer staged rollout with canary verification before full release.',
      sourceSessionId: 'loop-old',
      evidencePath: '/tmp/final.md',
      status: 'candidate',
    }])

    const context = await renderKnowledgeContext(artifacts, repoRoot)
    expect(context).toContain('Prefer staged rollout with canary verification before full release.')
  })
})

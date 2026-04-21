import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTaskKnowledge,
  loadInspectSnapshot,
  promoteKnowledgeCandidates,
  promoteKnowledgeCandidatesWithMemorySync,
  renderKnowledgeContext,
  updateTaskKnowledgeState,
  updateTaskKnowledgeSummary,
  type KnowledgeCandidate,
} from '../../src/knowledge/runtime.js'
import { getProjectMemoryPath } from '../../src/memory/runtime.js'

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
    await updateTaskKnowledgeState(artifacts, {
      currentStage: 'prd_review',
      lastReliableResult: 'Planning context synced.',
      nextAction: 'Run PRD review stage.',
      currentBlocker: 'Waiting for PRD review output.',
    }, 'State updated.')
    await updateTaskKnowledgeSummary(artifacts, 'open-issues', '- Waiting for migration rollback plan', 'Open issues updated.')
    await updateTaskKnowledgeSummary(artifacts, 'evidence', '- See /tmp/evidence.log', 'Evidence updated.')
    await updateTaskKnowledgeSummary(artifacts, 'stage-prd-review', 'Latest stage summary', 'Stage summary updated.')

    const inspect = await loadInspectSnapshot(artifacts)
    const promptContext = await renderKnowledgeContext(artifacts, process.cwd())

    expect(readFileSync(artifacts.knowledgeSchemaPath, 'utf-8')).toContain('# Task Knowledge Schema')
    expect(readFileSync(artifacts.knowledgeIndexPath, 'utf-8')).toContain('stage-prd-review.md')
    expect(readFileSync(artifacts.knowledgeStatePath, 'utf-8')).toContain('"currentStage": "prd_review"')
    expect(inspect.goal).toContain('Ship checkout v2 safely')
    expect(inspect.state.currentStage).toBe('prd_review')
    expect(inspect.state.nextAction).toBe('Run PRD review stage.')
    expect(inspect.latestSummary).toContain('Latest stage summary')
    expect(inspect.openIssues).toContain('migration rollback plan')
    expect(inspect.evidence).toContain('/tmp/evidence.log')
    expect(promptContext).toContain('Goal summary')
    expect(promptContext).toContain('Current stage: prd_review')
    expect(promptContext).toContain('Latest stage summary')
  })

  it('promotes decisions and workflow rules immediately and failure patterns by topic key on the second occurrence', async () => {
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
      lifecycle: 'active',
    }
    const workflowRule: KnowledgeCandidate = {
      type: 'workflow-rule',
      title: 'Always update README for CLI surface changes',
      summary: 'Whenever command output or flags change, sync README examples in the same task.',
      sourceSessionId: 'harness-1',
      evidencePath: '/tmp/final.md',
      status: 'candidate',
      appliesTo: ['README.md', 'src/cli/**'],
      lifecycle: 'active',
    }
    const failure: KnowledgeCandidate = {
      type: 'failure-pattern',
      title: 'review-cycle-timeout first wording',
      summary: 'Review cycle timed out before adjudication completed.',
      sourceSessionId: 'harness-1',
      evidencePath: '/tmp/events.jsonl',
      status: 'candidate',
      topicKey: 'review-cycle-timeout',
      lifecycle: 'deferred',
    }
    const sameFailureDifferentTitle: KnowledgeCandidate = {
      ...failure,
      title: 'review cycle timed out again',
      sourceSessionId: 'harness-2',
    }

    const first = await promoteKnowledgeCandidates(repoRoot, [decision, workflowRule, failure])
    const second = await promoteKnowledgeCandidates(repoRoot, [sameFailureDifferentTitle])

    const knowledgeRoot = join(magpieHome, 'knowledge')
    const indexPath = join(knowledgeRoot, first.repoKey, 'index.md')
    const decisionDir = join(knowledgeRoot, first.repoKey, 'decisions')
    const failureDir = join(knowledgeRoot, first.repoKey, 'failure-patterns')
    const workflowRuleDir = join(knowledgeRoot, first.repoKey, 'workflow-rules')

    expect(first.promoted.map((item) => item.type)).toContain('decision')
    expect(first.promoted.map((item) => item.type)).toContain('workflow-rule')
    expect(first.promoted.map((item) => item.type)).not.toContain('failure-pattern')
    expect(second.promoted.map((item) => item.type)).toContain('failure-pattern')
    expect(readFileSync(indexPath, 'utf-8')).toContain('Prefer explicit harness inspect output')
    expect(readFileSync(indexPath, 'utf-8')).toContain('Always update README for CLI surface changes')
    expect(readFileSync(indexPath, 'utf-8')).toContain('review cycle timed out again')
    expect(() => readFileSync(join(decisionDir, 'prefer-explicit-harness-inspect-output.md'), 'utf-8')).not.toThrow()
    expect(() => readFileSync(join(workflowRuleDir, 'always-update-readme-for-cli-surface-changes.md'), 'utf-8')).not.toThrow()
    expect(() => readFileSync(join(failureDir, 'review-cycle-timeout.md'), 'utf-8')).not.toThrow()
  })

  it('promotes repeated failure patterns from the repository failure index', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-index-promote-'))
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = mkdtempSync(join(tmpdir(), 'magpie-knowledge-repo-'))
    mkdirSync(join(repoRoot, '.magpie'), { recursive: true })
    writeFileSync(join(repoRoot, '.magpie', 'failure-index.json'), JSON.stringify({
      version: 1,
      updatedAt: '2026-04-12T10:00:00.000Z',
      entries: [{
        signature: 'workflow_defect|resume-checkpoint',
        category: 'workflow_defect',
        count: 2,
        capabilities: { loop: 2 },
        latestReason: 'Cannot safely resume because no reliable checkpoint was recorded.',
        lastSeenAt: '2026-04-12T10:00:00.000Z',
        latestEvidencePaths: ['/tmp/events.jsonl'],
        selfHealCandidateCount: 1,
        recentSessionIds: ['loop-a', 'loop-b'],
        recentEvidencePaths: ['/tmp/events.jsonl'],
      }],
    }, null, 2), 'utf-8')

    const promotion = await promoteKnowledgeCandidates(repoRoot, [])

    expect(promotion.promoted.some((candidate) => candidate.type === 'failure-pattern')).toBe(true)
    expect(readFileSync(join(magpieHome, 'knowledge', promotion.repoKey, 'index.md'), 'utf-8')).toContain('Cannot safely resume')
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
      lifecycle: 'active',
    }])

    const context = await renderKnowledgeContext(artifacts, repoRoot)
    expect(context).toContain('Prefer staged rollout with canary verification before full release.')
  })

  it('compacts oversized context and reuses compacted summary when requested', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-compaction-'))
    process.env.MAGPIE_HOME = magpieHome

    const sessionDir = mkdtempSync(join(tmpdir(), 'magpie-knowledge-session-'))
    const repoRoot = join(tmpdir(), 'magpie-knowledge-repo-compact')
    const artifacts = await createTaskKnowledge({
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-compact',
      title: 'Compact context',
      goal: 'Keep loop context stable under long runs',
    })

    const longText = 'stable rollout constraint '.repeat(300)
    await updateTaskKnowledgeSummary(artifacts, 'open-issues', `- ${longText}`, 'Open issues expanded.')
    await updateTaskKnowledgeSummary(artifacts, 'stage-prd-review', `# Stage prd_review\n\n${longText}`, 'Stage digest expanded.')
    await updateTaskKnowledgeState(artifacts, {
      currentStage: 'implementation',
      lastReliableResult: 'Domain boundaries confirmed.',
      nextAction: 'Implement retry-safe execution path.',
      currentBlocker: 'Need final test evidence.',
    }, 'State expanded.')

    const compacted = await renderKnowledgeContext(artifacts, repoRoot, { maxChars: 900 })
    const preferred = await renderKnowledgeContext(artifacts, repoRoot, { preferCompactedSummary: true })

    expect(compacted).toContain('Task knowledge context (compacted):')
    expect(compacted).toContain('Retained decisions')
    expect(compacted).toContain('Pending actions')
    expect(compacted.length).toBeLessThanOrEqual(1300)
    expect(preferred).toContain('Task knowledge context (compacted summary):')
    expect(preferred).toContain('Compacted Context')
    expect(readFileSync(artifacts.knowledgeCompactionPath!, 'utf-8')).toContain('Compacted Context')
  })

  it('refreshes compacted summary content before preferred reuse', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-compaction-refresh-'))
    process.env.MAGPIE_HOME = magpieHome

    const sessionDir = mkdtempSync(join(tmpdir(), 'magpie-knowledge-session-'))
    const repoRoot = join(tmpdir(), 'magpie-knowledge-repo-compact-refresh')
    const artifacts = await createTaskKnowledge({
      sessionDir,
      capability: 'loop',
      sessionId: 'loop-compact-refresh',
      title: 'Compact context refresh',
      goal: 'Keep compacted summary fresh during resume',
    })

    const longText = 'stable rollout constraint '.repeat(300)
    await updateTaskKnowledgeSummary(artifacts, 'open-issues', `- ${longText}`, 'Open issues expanded.')
    await updateTaskKnowledgeState(artifacts, {
      currentStage: 'implementation',
      lastReliableResult: 'Domain boundaries confirmed.',
      nextAction: 'Implement retry-safe execution path.',
      currentBlocker: 'Need final test evidence.',
    }, 'State expanded.')

    const first = await renderKnowledgeContext(artifacts, repoRoot, {
      maxChars: 900,
      preferCompactedSummary: true,
    })
    expect(first).toContain('Need final test evidence.')

    await updateTaskKnowledgeState(artifacts, {
      currentBlocker: 'Need integration retry evidence.',
    }, 'Blocker changed.')

    const refreshed = await renderKnowledgeContext(artifacts, repoRoot, {
      maxChars: 900,
      preferCompactedSummary: true,
    })
    expect(refreshed).toContain('Need integration retry evidence.')
    expect(refreshed).not.toContain('Need final test evidence.')
  })

  it('syncs only promoted knowledge into project memory', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-knowledge-memory-sync-'))
    process.env.MAGPIE_HOME = magpieHome

    const repoRoot = join(tmpdir(), 'magpie-knowledge-repo-memory-sync')
    const decision: KnowledgeCandidate = {
      type: 'decision',
      title: 'Prefer staged rollout',
      summary: 'Ship to canary first, then expand.',
      sourceSessionId: 'loop-100',
      status: 'candidate',
    }
    const failure: KnowledgeCandidate = {
      type: 'failure-pattern',
      title: 'worktree missing',
      summary: 'Worktree directory was missing before execution started.',
      topicKey: 'worktree-missing',
      sourceSessionId: 'loop-101',
      status: 'candidate',
    }

    const first = await promoteKnowledgeCandidatesWithMemorySync(repoRoot, [decision, failure])
    const second = await promoteKnowledgeCandidatesWithMemorySync(repoRoot, [{ ...failure, sourceSessionId: 'loop-102' }])

    const content = readFileSync(getProjectMemoryPath(repoRoot), 'utf-8')

    expect(first.promoted.map((item) => item.type)).toEqual(['decision'])
    expect(first.deferred.map((item) => item.type)).toEqual(['failure-pattern'])
    expect(second.promoted.map((item) => item.type)).toEqual(['failure-pattern'])
    expect(content).toContain('Prefer staged rollout')
    expect(content).toContain('worktree missing')
    expect(content.match(/worktree missing/g)).toHaveLength(1)
  })
})

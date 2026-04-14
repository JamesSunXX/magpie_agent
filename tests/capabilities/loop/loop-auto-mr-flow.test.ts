import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { loopCapability } from '../../../src/capabilities/loop/index.js'

const autoMrMocks = vi.hoisted(() => ({
  createLoopMr: vi.fn(),
}))

vi.mock('../../../src/capabilities/loop/domain/auto-mr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/capabilities/loop/domain/auto-mr.js')>()
  return {
    ...actual,
    createLoopMr: autoMrMocks.createLoopMr,
  }
})

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "bot@example.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Magpie Bot"', { cwd: dir, stdio: 'pipe' })
  execSync('git checkout -b sch/existing', { cwd: dir, stdio: 'pipe' })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'sample-prd.md'), '# PRD\n\nA sample requirement.\n', 'utf-8')
  writeFileSync(join(dir, 'README.md'), '# Demo\n', 'utf-8')
  execSync('git add -A', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "chore: init repo"', { cwd: dir, stdio: 'pipe' })
}

function buildConfig(dir: string): string {
  const configPath = join(dir, 'config.yaml')
  writeFileSync(configPath, `providers:
  claude-code:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  mock-reviewer:
    model: mock
    prompt: review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  loop:
    enabled: true
    planner_model: mock
    executor_model: mock
    stages: [prd_review]
    confidence_threshold: 0.3
    retries_per_stage: 1
    max_iterations: 2
    auto_commit: true
    reuse_current_branch: true
    auto_branch_prefix: "sch/"
    mr:
      enabled: true
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "manual_only"
      poll_interval_sec: 1
integrations:
  notifications:
    enabled: true
    stage_ai:
      enabled: false
      provider: mock
      max_summary_chars: 900
      include_loop: true
      include_harness: true
    routes:
      loop_auto_mr_created: [feishu_team]
      loop_auto_mr_manual_follow_up: [feishu_team]
    providers:
      feishu_team:
        type: feishu-webhook
        webhook_url: https://example.com/hook
`, 'utf-8')
  return configPath
}

describe('loop auto mr integration', () => {
  afterEach(() => {
    autoMrMocks.createLoopMr.mockReset()
    vi.unstubAllGlobals()
  })

  it('stores the created mr url after loop completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-auto-mr-created-'))
    initRepo(dir)
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    autoMrMocks.createLoopMr.mockResolvedValue({
      status: 'created',
      branchName: 'sch/existing',
      url: 'https://gitlab.example.com/group/project/-/merge_requests/123',
      needsHuman: false,
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath: buildConfig(dir) })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath: join(dir, 'docs', 'sample-prd.md'),
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.summary).toContain('MR created')
    expect(result.result.session?.artifacts.mrResultPath).toBeTruthy()
    expect(existsSync(result.result.session!.artifacts.mrResultPath!)).toBe(true)
    expect(readFileSync(result.result.session!.artifacts.mrResultPath!, 'utf-8')).toContain('merge_requests/123')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('keeps loop completed and records manual follow-up when auto mr fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-auto-mr-manual-'))
    initRepo(dir)
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    autoMrMocks.createLoopMr.mockResolvedValue({
      status: 'manual_follow_up',
      branchName: 'sch/existing',
      reason: 'remote rejected',
      needsHuman: true,
    })

    const ctx = createCapabilityContext({ cwd: dir, configPath: buildConfig(dir) })
    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath: join(dir, 'docs', 'sample-prd.md'),
      waitHuman: false,
      dryRun: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.summary).toContain('MR 需要人工补做')
    expect(readFileSync(result.result.session!.artifacts.mrResultPath!, 'utf-8')).toContain('"needsHuman": true')
    expect(fetchMock).toHaveBeenCalled()
  })
})

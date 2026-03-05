import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { loopCapability } from '../../../src/capabilities/loop/index.js'

describe('loop capability', () => {
  it('runs a minimal dry-run loop session with mock providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })

    const prdPath = join(dir, 'docs', 'sample-prd.md')
    writeFileSync(prdPath, '# PRD\n\nA sample requirement.', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  loop:\n    enabled: true\n    planner_model: mock\n    executor_model: mock\n    stages: [prd_review]\n    confidence_threshold: 0.3\n    retries_per_stage: 1\n    max_iterations: 2\n    auto_commit: false\n    auto_branch_prefix: "sch/"\n    human_confirmation:\n      file: "human_confirmation.md"\n      gate_policy: "manual_only"\n      poll_interval_sec: 1\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({
      cwd: dir,
      configPath,
    })

    const result = await runCapability(loopCapability, {
      mode: 'run',
      goal: 'Complete delivery flow',
      prdPath,
      waitHuman: false,
      dryRun: true,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session).toBeDefined()
    expect(result.result.session?.stages).toEqual(['prd_review'])
  })
})

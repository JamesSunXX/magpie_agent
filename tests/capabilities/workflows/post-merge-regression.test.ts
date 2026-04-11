import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { postMergeRegressionCapability } from '../../../src/capabilities/workflows/post-merge-regression/index.js'

describe('post-merge-regression workflow', () => {
  it('runs configured regression commands and persists a summary report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-regression-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  post_merge_regression:\n    enabled: true\n    evaluator_model: mock\n    evaluator_agent: code-reviewer\n    commands:\n      - "node --version"\n      - "npm --version"\nintegrations:\n  notifications:\n    enabled: false\n  operations:\n    enabled: true\n    default_provider: local_main\n    providers:\n      local_main:\n        type: local-commands\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(postMergeRegressionCapability, {}, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.reportPath).toBeTruthy()
    expect(readFileSync(result.result.session!.artifacts.reportPath, 'utf-8')).toContain('node --version')
    expect(result.result.session?.artifacts.evidencePath).toBeTruthy()
    expect(result.result.session?.evidence?.runs[0]?.command).toBe('node --version')
  })

  it('blocks dangerous commands even when operations integration is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-regression-dangerous-'))
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  safety:\n    require_confirmation_for_dangerous: true\n  post_merge_regression:\n    enabled: true\n    evaluator_model: mock\n    evaluator_agent: code-reviewer\n    commands:\n      - "git reset --hard"\nintegrations:\n  notifications:\n    enabled: false\n  operations:\n    enabled: true\n    default_provider: local_main\n    providers:\n      local_main:\n        type: local-commands\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(postMergeRegressionCapability, {}, ctx)

    expect(result.result.status).toBe('failed')
    expect(result.result.session?.evidence?.runs[0]?.passed).toBe(false)
    expect(result.result.session?.evidence?.runs[0]?.output).toContain('Dangerous command blocked')
  })
})

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { docsSyncCapability } from '../../../src/capabilities/workflows/docs-sync/index.js'

describe('docs-sync workflow', () => {
  it('collects repo docs and writes a repo-aware update brief', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-docs-sync-'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'README.md'), '# Demo\n\nOld summary.\n', 'utf-8')
    writeFileSync(join(dir, 'docs', 'architecture.md'), '# Architecture\n\nLegacy notes.\n', 'utf-8')
    writeFileSync(join(dir, 'src', 'feature.ts'), 'export function feature() { return "new-behavior" }\n', 'utf-8')

    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  mock-reviewer:\n    model: mock\n    prompt: review\nsummarizer:\n  model: mock\n  prompt: summarize\nanalyzer:\n  model: mock\n  prompt: analyze\ncapabilities:\n  docs_sync:\n    enabled: true\n    reviewer_model: mock\n    docs_patterns: [README.md, docs]\nintegrations:\n  notifications:\n    enabled: false\n`, 'utf-8')

    const ctx = createCapabilityContext({ cwd: dir, configPath })
    const result = await runCapability(docsSyncCapability, {
      apply: false,
    }, ctx)

    expect(result.result.status).toBe('completed')
    expect(result.result.session?.artifacts.reportPath).toBeTruthy()
    expect(readFileSync(result.result.session!.artifacts.reportPath, 'utf-8')).toContain('README.md')
  })
})

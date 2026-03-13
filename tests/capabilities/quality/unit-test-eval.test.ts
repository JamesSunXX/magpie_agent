import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { unitTestEvalCapability } from '../../../src/capabilities/quality/unit-test-eval/index.js'

describe('unit-test-eval capability', () => {
  it('produces evaluation summary for local project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-quality-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    mkdirSync(join(dir, 'tests'), { recursive: true })

    writeFileSync(join(dir, 'src', 'sum.ts'), 'export const sum = (a:number,b:number)=>a+b\n')
    writeFileSync(join(dir, 'tests', 'sum.test.ts'), 'import { describe, it, expect } from \"vitest\"\n')

    const config = `providers:\n  claude-code:\n    enabled: true\ndefaults:\n  max_rounds: 3\n  output_format: markdown\n  check_convergence: true\nreviewers:\n  claude:\n    model: claude-code\n    prompt: review\nsummarizer:\n  model: claude-code\n  prompt: summarize\nanalyzer:\n  model: claude-code\n  prompt: analyze\ncapabilities:\n  quality:\n    unitTestEval:\n      enabled: true\n      provider: claude-code\n      max_files: 50\n      min_coverage: 0.8\n      output_format: json\nintegrations:\n  notifications:\n    enabled: false\n`
    const configPath = join(dir, 'config.yaml')
    writeFileSync(configPath, config)

    const ctx = createCapabilityContext({
      cwd: dir,
      configPath,
      metadata: { format: 'json' },
    })

    const res = await runCapability(unitTestEvalCapability, { path: dir, format: 'json' }, ctx)

    expect(res.result.coverage.sourceFileCount).toBeGreaterThan(0)
    expect(res.result.generatedTests.length).toBeGreaterThan(0)
    expect(res.output.format).toBe('json')
  })
})

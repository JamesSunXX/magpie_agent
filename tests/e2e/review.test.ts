// tests/e2e/review.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('E2E: magpie review', () => {
  const cliCommand = 'npm run dev --'
  const testDir = join(tmpdir(), 'magpie-e2e-' + Date.now())
  const configPath = join(testDir, '.magpie', 'config.yaml')

  beforeAll(() => {
    mkdirSync(join(testDir, '.magpie'), { recursive: true })
    // Create minimal test config (will need mock or real API keys for actual test)
    writeFileSync(configPath, `
providers:
  anthropic:
    api_key: \${ANTHROPIC_API_KEY}
defaults:
  max_rounds: 1
  output_format: markdown
reviewers:
  test-reviewer:
    model: claude-sonnet-4-20250514
    prompt: You are a test reviewer
summarizer:
  model: claude-sonnet-4-20250514
  prompt: Summarize the review
`)
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should show help', () => {
    const output = execSync(`${cliCommand} --help`).toString()
    expect(output).toContain('magpie')
    expect(output).toContain('review')
    expect(output).toContain('init')
  })

  it('should show review help', () => {
    const output = execSync(`${cliCommand} review --help`).toString()
    expect(output).toContain('PR number or URL')
    expect(output).toContain('--interactive')
  })
})

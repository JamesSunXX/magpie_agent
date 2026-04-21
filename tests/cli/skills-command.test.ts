import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'

describe('skills CLI command', () => {
  const dirs: string[] = []

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.exitCode = 0
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  function writeConfig(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-skills-cli-'))
    dirs.push(cwd)
    const configPath = join(cwd, 'config.yaml')
    writeFileSync(configPath, `
providers:
  codex:
    enabled: true
  kiro:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  codex:
    tool: codex
    prompt: review
summarizer:
  tool: codex
  prompt: summarize
analyzer:
  tool: codex
  prompt: analyze
capabilities:
  skills:
    enabled: true
    defaults:
      loop: [guided-onboarding]
integrations:
  notifications:
    enabled: false
`, 'utf-8')
    return configPath
  }

  it('lists available skills with their readiness', async () => {
    const configPath = writeConfig()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { skillsCommand } = await import('../../src/cli/commands/skills.js')

    await skillsCommand.parseAsync(['node', 'skills', 'list', '--config', configPath], { from: 'node' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('guided-onboarding'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('enabled'))
  })

  it('enables and disables a skill in the local config', async () => {
    const configPath = writeConfig()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { skillsCommand } = await import('../../src/cli/commands/skills.js')

    await skillsCommand.parseAsync(['node', 'skills', 'enable', 'task-state', '--config', configPath], { from: 'node' })
    let parsed = YAML.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.capabilities.skills.overrides['task-state'].enabled).toBe(true)

    await skillsCommand.parseAsync(['node', 'skills', 'disable', 'task-state', '--config', configPath], { from: 'node' })
    parsed = YAML.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.capabilities.skills.overrides['task-state'].enabled).toBe(false)

    logSpy.mockRestore()
  })
})

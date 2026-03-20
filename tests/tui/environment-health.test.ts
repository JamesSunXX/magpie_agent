import { mkdirSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkEnvironmentHealth } from '../../src/tui/environment-health.js'

describe('environment health', () => {
  it('reports config, git, workspace, and provider readiness', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-env-'))
    const configPath = join(repoDir, '.magpie', 'config.yaml')

    mkdirSync(join(repoDir, '.magpie'), { recursive: true })
    writeFileSync(configPath, 'defaults:\n  max_rounds: 3\n', 'utf-8')
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })

    const result = checkEnvironmentHealth({ cwd: repoDir, configPath })

    expect(result.items.find((item) => item.key === 'config')).toMatchObject({ status: 'ok' })
    expect(result.items.find((item) => item.key === 'git')).toMatchObject({ status: 'ok' })
    expect(result.items.find((item) => item.key === 'workspace')).toMatchObject({ status: 'ok' })
    expect(result.items.find((item) => item.key === 'providers')).toMatchObject({ status: 'unknown' })
  })

  it('reports missing config and repo state when unavailable', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-env-missing-'))

    const result = checkEnvironmentHealth({
      cwd: repoDir,
      configPath: join(repoDir, '.magpie', 'config.yaml'),
    })

    expect(result.items.find((item) => item.key === 'config')).toMatchObject({ status: 'warning' })
    expect(result.items.find((item) => item.key === 'git')).toMatchObject({ status: 'warning' })
    expect(result.items.find((item) => item.key === 'workspace')).toMatchObject({ status: 'warning' })
  })
})

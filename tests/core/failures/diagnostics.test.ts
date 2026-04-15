import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFailureDiagnostics } from '../../../src/core/failures/diagnostics.js'

describe('failure diagnostics', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports missing inputs and required paths as blocking issues', async () => {
    const result = await runFailureDiagnostics({
      configPath: '/tmp/does-not-exist-config.yaml',
      metadataPath: '/tmp/does-not-exist-metadata.json',
      requiredPaths: ['/tmp/does-not-exist-repo-path'],
    })

    expect(result.hasBlockingIssues).toBe(true)
    expect(result.checks).toEqual([
      {
        id: 'config_exists',
        passed: false,
        message: 'Config path is missing or no longer exists.',
        path: '/tmp/does-not-exist-config.yaml',
      },
      {
        id: 'input_metadata_exists',
        passed: false,
        message: 'Session input metadata is missing.',
        path: '/tmp/does-not-exist-metadata.json',
      },
      {
        id: 'repo_paths_exist:1',
        passed: false,
        message: 'Required repository path is missing: /tmp/does-not-exist-repo-path',
        path: '/tmp/does-not-exist-repo-path',
      },
    ])
  })

  it('passes when config, metadata, and required repository paths exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-failure-diagnostics-'))
    tempDirs.push(dir)

    const configPath = join(dir, 'config.yaml')
    const metadataPath = join(dir, 'input.json')
    const repoPath = join(dir, 'docs')

    writeFileSync(configPath, 'providers: {}', 'utf-8')
    writeFileSync(metadataPath, '{"goal":"Ship failure ledger"}', 'utf-8')
    mkdirSync(repoPath, { recursive: true })

    const result = await runFailureDiagnostics({
      configPath,
      metadataPath,
      requiredPaths: [repoPath],
    })

    expect(result.hasBlockingIssues).toBe(false)
    expect(result.checks).toEqual([
      {
        id: 'config_exists',
        passed: true,
        message: 'config_exists ok',
        path: configPath,
      },
      {
        id: 'input_metadata_exists',
        passed: true,
        message: 'input_metadata_exists ok',
        path: metadataPath,
      },
      {
        id: 'repo_paths_exist:1',
        passed: true,
        message: 'Repository path is available.',
        path: repoPath,
      },
    ])
  })
})

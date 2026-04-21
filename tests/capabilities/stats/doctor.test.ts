import { describe, expect, it } from 'vitest'
import { runDoctorChecks } from '../../../src/capabilities/stats/application/doctor.js'

describe('doctor checks', () => {
  it('reports missing config file with actionable fix command', () => {
    const result = runDoctorChecks(
      {
        cwd: '/tmp/repo',
      },
      {
        getConfigPath: () => '/tmp/repo/.magpie/config.yaml',
        existsSync: () => false,
        getConfigVersionStatus: () => ({
          path: '/tmp/repo/.magpie/config.yaml',
          expectedVersion: 22,
          state: 'current',
        }),
        loadConfig: () => {
          throw new Error('not needed')
        },
        checkCommand: () => true,
        env: {},
      }
    )

    const missing = result.checks.find((item) => item.id === 'config_file')
    expect(missing).toEqual(expect.objectContaining({
      status: 'fail',
      fixCommand: 'magpie init --config /tmp/repo/.magpie/config.yaml',
    }))
    expect(result.summary.fail).toBe(1)
  })

  it('reports outdated config and missing cli/api requirements', () => {
    const result = runDoctorChecks(
      {
        cwd: '/tmp/repo',
      },
      {
        getConfigPath: () => '/tmp/repo/.magpie/config.yaml',
        existsSync: () => true,
        getConfigVersionStatus: () => ({
          path: '/tmp/repo/.magpie/config.yaml',
          configVersion: 20,
          expectedVersion: 22,
          state: 'outdated',
          message: 'Config version is outdated.',
        }),
        loadConfig: () => ({
          config_version: 22,
          defaults: {
            max_rounds: 3,
            output_format: 'markdown',
            check_convergence: true,
          },
          reviewers: {
            codex: {
              tool: 'codex',
              prompt: 'Use codex.',
            },
            gpt: {
              model: 'gpt-5.2',
              prompt: 'Use gpt.',
            },
          },
          summarizer: {
            tool: 'codex',
            prompt: 'sum',
          },
          analyzer: {
            tool: 'codex',
            prompt: 'ana',
          },
          capabilities: {
            discuss: {},
            review: {},
            trd: {},
            issue_fix: {},
            docs_sync: {},
            post_merge_regression: {},
            routing: {},
            loop: {},
            harness: {},
          },
          integrations: {},
          providers: {
            openai: {
              api_key: '',
            },
          },
        }),
        checkCommand: (name) => name !== 'codex',
        env: {},
      }
    )

    expect(result.checks.find((item) => item.id === 'config_version')?.status).toBe('fail')
    expect(result.checks.find((item) => item.id === 'cli_codex')?.status).toBe('fail')
    expect(result.checks.find((item) => item.id === 'api_openai')?.status).toBe('fail')
    expect(result.summary.fail).toBeGreaterThanOrEqual(3)
  })

  it('passes when requirements are satisfied', () => {
    const result = runDoctorChecks(
      {
        cwd: '/tmp/repo',
      },
      {
        getConfigPath: () => '/tmp/repo/.magpie/config.yaml',
        existsSync: () => true,
        getConfigVersionStatus: () => ({
          path: '/tmp/repo/.magpie/config.yaml',
          configVersion: 22,
          expectedVersion: 22,
          state: 'current',
        }),
        loadConfig: () => ({
          config_version: 22,
          defaults: {
            max_rounds: 3,
            output_format: 'markdown',
            check_convergence: true,
          },
          reviewers: {
            codex: {
              tool: 'codex',
              prompt: 'Use codex.',
            },
          },
          summarizer: {
            tool: 'codex',
            prompt: 'sum',
          },
          analyzer: {
            tool: 'codex',
            prompt: 'ana',
          },
          capabilities: {
            discuss: {},
            review: {},
            trd: {},
            issue_fix: {},
            docs_sync: {},
            post_merge_regression: {},
            routing: {},
            loop: {},
            harness: {},
          },
          integrations: {},
          providers: {},
        }),
        checkCommand: () => true,
        env: {},
      }
    )

    expect(result.summary.fail).toBe(0)
    expect(result.checks.find((item) => item.id === 'config_file')?.status).toBe('pass')
    expect(result.checks.find((item) => item.id === 'config_schema')?.status).toBe('pass')
    expect(result.checks.find((item) => item.id === 'config_version')?.status).toBe('pass')
  })
})

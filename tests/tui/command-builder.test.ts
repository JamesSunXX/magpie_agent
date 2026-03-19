import { describe, expect, it } from 'vitest'
import { buildResumeCommand, buildTaskCommand } from '../../src/tui/command-builder.js'
import type { SessionCard } from '../../src/tui/types.js'

describe('TUI command builder', () => {
  it('builds a local change review command', () => {
    expect(buildTaskCommand('change-review', { mode: 'local' })).toEqual({
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    })
  })

  it('builds a branch change review command', () => {
    expect(buildTaskCommand('change-review', { mode: 'branch', branchBase: 'main' })).toEqual({
      argv: ['review', '--branch', 'main'],
      display: 'magpie review --branch main',
      summary: 'Review the current branch against main',
    })
  })

  it('builds a files change review command', () => {
    expect(buildTaskCommand('change-review', { mode: 'files', files: 'src/a.ts, src/b.ts' })).toEqual({
      argv: ['review', '--files', 'src/a.ts', 'src/b.ts'],
      display: 'magpie review --files src/a.ts src/b.ts',
      summary: 'Review selected files',
    })
  })

  it('builds a repo change review command', () => {
    expect(buildTaskCommand('change-review', { mode: 'repo', path: 'src', ignore: 'dist,coverage' })).toEqual({
      argv: ['review', '--repo', '--path', 'src', '--ignore', 'dist', 'coverage'],
      display: 'magpie review --repo --path src --ignore dist coverage',
      summary: 'Review the repository scope',
    })
  })

  it('builds a PR review command', () => {
    expect(buildTaskCommand('pr-review', { pr: '123' })).toEqual({
      argv: ['review', '123'],
      display: 'magpie review 123',
      summary: 'Review PR 123',
    })
  })

  it('builds a TRD command', () => {
    expect(buildTaskCommand('trd-generation', { prdPath: '/tmp/prd.md', autoAcceptDomains: true })).toEqual({
      argv: ['trd', '/tmp/prd.md', '--auto-accept-domains'],
      display: 'magpie trd /tmp/prd.md --auto-accept-domains',
      summary: 'Generate a TRD from /tmp/prd.md',
    })
  })

  it('builds a loop run command', () => {
    expect(
      buildTaskCommand('loop-run', {
        goal: 'Stabilize the TUI',
        prdPath: '/tmp/prd.md',
        planningItem: 'ENG-42',
        maxIterations: '3',
      })
    ).toEqual({
      argv: ['loop', 'run', 'Stabilize the TUI', '--prd', '/tmp/prd.md', '--planning-item', 'ENG-42', '--max-iterations', '3'],
      display: 'magpie loop run "Stabilize the TUI" --prd /tmp/prd.md --planning-item ENG-42 --max-iterations 3',
      summary: 'Run the goal loop for "Stabilize the TUI"',
    })
  })

  it('builds an issue-fix command', () => {
    expect(
      buildTaskCommand('issue-fix', {
        issue: 'Crash when opening dashboard',
        apply: true,
        verifyCommand: 'npm run test:run',
      })
    ).toEqual({
      argv: ['workflow', 'issue-fix', 'Crash when opening dashboard', '--apply', '--verify-command', 'npm run test:run'],
      display: 'magpie workflow issue-fix "Crash when opening dashboard" --apply --verify-command "npm run test:run"',
      summary: 'Run the issue-fix workflow for "Crash when opening dashboard"',
    })
  })

  it('reuses dashboard resume commands', () => {
    const card: SessionCard = {
      id: 'loop-123',
      capability: 'loop',
      title: 'Paused loop',
      status: 'paused_for_human',
      updatedAt: new Date('2026-03-19T10:00:00.000Z'),
      resumeCommand: ['loop', 'resume', 'loop-123'],
      artifactPaths: ['/tmp/human_confirmation.md'],
    }

    expect(buildResumeCommand(card)).toEqual({
      argv: ['loop', 'resume', 'loop-123'],
      display: 'magpie loop resume loop-123',
      summary: 'Resume loop session loop-123',
    })
  })
})

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkflowEvent,
  buildCommandSafetyConfig,
  classifyDangerousCommand,
  generateWorkflowId,
  isRecoverableHarnessSession,
  isRecoverableLoopSession,
  listWorkflowSessions,
  loadWorkflowSession,
  parseCommandArgs,
  persistWorkflowSession,
  runSafeCommand,
  sessionDirFor,
} from '../../../../src/capabilities/workflows/shared/runtime.js'

describe('workflow shared runtime helpers', () => {
  let magpieHome: string | undefined
  let cwd: string | undefined

  afterEach(() => {
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      magpieHome = undefined
      delete process.env.MAGPIE_HOME
    }
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true })
      cwd = undefined
    }
  })

  it('persists, loads, and lists workflow sessions in updated order', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    await persistWorkflowSession(cwd, {
      id: 'harness-a',
      capability: 'harness',
      title: 'First session',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:00:00.000Z'),
      status: 'in_progress',
      currentStage: 'reviewing',
      summary: 'Reviewing changes.',
      artifacts: {
        eventsPath: '/tmp/a-events.jsonl',
      },
    })

    await persistWorkflowSession(cwd, {
      id: 'harness-b',
      capability: 'harness',
      title: 'Second session',
      createdAt: new Date('2026-04-10T08:30:00.000Z'),
      updatedAt: new Date('2026-04-10T09:30:00.000Z'),
      status: 'completed',
      currentStage: 'completed',
      summary: 'Done.',
      artifacts: {
        eventsPath: '/tmp/b-events.jsonl',
      },
    })

    const loaded = await loadWorkflowSession(cwd, 'harness', 'harness-a')
    const listed = await listWorkflowSessions(cwd, 'harness')

    expect(loaded?.updatedAt).toBeInstanceOf(Date)
    expect(loaded?.currentStage).toBe('reviewing')
    expect(listed.map((session) => session.id)).toEqual(['harness-b', 'harness-a'])
    expect(readFileSync(join(cwd, '.magpie', 'sessions', 'harness', 'harness-a', 'session.json'), 'utf-8')).toContain('"id": "harness-a"')
  })

  it('returns null or empty list when workflow sessions are missing', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-empty-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-empty-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    expect(await loadWorkflowSession(cwd, 'harness', 'missing')).toBeNull()
    expect(await listWorkflowSessions(cwd, 'harness')).toEqual([])
  })

  it('preserves existing workflow artifacts when later saves omit tmux details', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-merge-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-merge-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    await persistWorkflowSession(cwd, {
      id: 'harness-a',
      capability: 'harness',
      title: 'First session',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:00:00.000Z'),
      status: 'in_progress',
      currentStage: 'queued',
      summary: 'Queued.',
      artifacts: {
        eventsPath: '/tmp/events.jsonl',
        tmuxSession: 'magpie-harness-a',
        tmuxWindow: '@1',
        tmuxPane: '%1',
      },
    })

    await persistWorkflowSession(cwd, {
      id: 'harness-a',
      capability: 'harness',
      title: 'First session',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:05:00.000Z'),
      status: 'completed',
      currentStage: 'completed',
      summary: 'Done.',
      artifacts: {
        eventsPath: '/tmp/events.jsonl',
      },
    })

    const loaded = await loadWorkflowSession(cwd, 'harness', 'harness-a')
    expect(loaded?.artifacts.tmuxSession).toBe('magpie-harness-a')
    expect(loaded?.artifacts.tmuxWindow).toBe('@1')
    expect(loaded?.artifacts.tmuxPane).toBe('%1')
  })

  it('appends workflow events to the persisted jsonl stream', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-events-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-events-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    const eventsPath = await appendWorkflowEvent(cwd, 'harness', 'harness-a', {
      timestamp: new Date('2026-04-10T09:00:00.000Z'),
      type: 'workflow_started',
      stage: 'queued',
      summary: 'Harness workflow started.',
    })

    const raw = readFileSync(eventsPath, 'utf-8').trim()
    expect(raw).toContain('"type":"workflow_started"')
    expect(raw).toContain('"stage":"queued"')
  })

  it('parses shell-safe command arguments and rejects unsafe input', () => {
    expect(parseCommandArgs('npm run test:run -- --grep "harness flow"')).toEqual([
      'npm',
      'run',
      'test:run',
      '--',
      '--grep',
      'harness flow',
    ])
    expect(() => parseCommandArgs('')).toThrow('Command must not be empty')
    expect(() => parseCommandArgs('echo hi | cat')).toThrow('Unsupported shell metacharacters in command')
    expect(() => parseCommandArgs('echo "unterminated')).toThrow('Unterminated command quoting')
  })

  it('runs safe commands and captures failure output', () => {
    const ok = runSafeCommand(process.cwd(), 'node --version')
    const failed = runSafeCommand(process.cwd(), 'node --definitely-invalid-flag')

    expect(ok.passed).toBe(true)
    expect(ok.output).toContain('v')
    expect(failed.passed).toBe(false)
    expect(failed.output.length).toBeGreaterThan(0)
  })

  it('classifies dangerous commands and blocks them by default in non-interactive mode', () => {
    expect(classifyDangerousCommand('rm -rf dist')).toContain('rm -rf')
    expect(classifyDangerousCommand('git push --force origin main')).toContain('git push --force')

    const blocked = runSafeCommand(process.cwd(), 'rm -rf dist', {
      safety: buildCommandSafetyConfig(),
      interactive: false,
    })

    expect(blocked.passed).toBe(false)
    expect(blocked.output).toContain('Dangerous command blocked')
  })

  it('allows dangerous pattern matching to be disabled', () => {
    expect(classifyDangerousCommand('rm -rf dist', buildCommandSafetyConfig({
      require_confirmation_for_dangerous: false,
    }))).toBeNull()
  })

  it('generates workflow ids and session directories under MAGPIE_HOME', () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-paths-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-paths-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    const id = generateWorkflowId('harness')
    const dir = sessionDirFor(cwd, 'harness', 'example-session')

    expect(id).toMatch(/^harness-[0-9a-f]{8}$/)
    expect(dir).toBe(join(realpathSync(cwd), '.magpie', 'sessions', 'harness', 'example-session'))
  })

  it('detects recoverable loop sessions from persisted workspace evidence', () => {
    expect(isRecoverableLoopSession({
      status: 'failed',
      currentStageIndex: 0,
      stages: ['code_development'],
      currentLoopState: 'blocked_for_human',
      lastReliablePoint: 'red_test_confirmed',
      lastFailureReason: 'Continue from the current workspace.',
      artifacts: {
        workspacePath: '/tmp/workspace',
        nextRoundInputPath: '/tmp/next.md',
        redTestResultPath: '/tmp/red.json',
      },
      stageResults: [],
    })).toBe(true)

    expect(isRecoverableLoopSession({
      status: 'failed',
      currentStageIndex: 0,
      stages: ['code_development'],
      lastReliablePoint: 'half_written_output',
      artifacts: {
        workspacePath: '/tmp/workspace',
        nextRoundInputPath: '/tmp/next.md',
        redTestResultPath: '/tmp/red.json',
      },
    })).toBe(false)
  })

  it('treats a failed verification stage with a saved rerun brief as recoverable', () => {
    expect(isRecoverableLoopSession({
      status: 'failed',
      currentStageIndex: 1,
      stages: ['code_development', 'unit_mock_test'],
      lastReliablePoint: 'constraints_validated',
      artifacts: {
        workspacePath: '/tmp/workspace',
        nextRoundInputPath: '/tmp/next.md',
      },
      stageResults: [{
        stage: 'unit_mock_test',
        success: false,
        confidence: 0.4,
        summary: 'Mock tests failed and need another pass.',
        risks: ['rerun after fixing the failing mock setup'],
        retryCount: 0,
        artifacts: ['/tmp/unit-mock-test.md'],
        timestamp: new Date('2026-04-15T00:00:00.000Z'),
      }],
    })).toBe(true)
  })

  it('requires a recoverable inner loop session before failed harness development can resume', () => {
    const failedHarnessSession = {
      id: 'harness-1',
      capability: 'harness' as const,
      title: 'Deliver checkout v2',
      createdAt: new Date('2026-04-14T00:00:00.000Z'),
      updatedAt: new Date('2026-04-14T00:10:00.000Z'),
      status: 'failed' as const,
      currentStage: 'developing',
      summary: 'Harness failed during loop development stage.',
      artifacts: {
        workspacePath: '/tmp/workspace',
        loopSessionId: 'loop-1',
      },
    }

    expect(isRecoverableHarnessSession(
      failedHarnessSession,
      {
        status: 'failed',
        currentStageIndex: 0,
        stages: ['code_development'],
        currentLoopState: 'blocked_for_human',
        lastReliablePoint: 'red_test_confirmed',
        lastFailureReason: 'Resume from the current workspace.',
        artifacts: {
          workspacePath: '/tmp/workspace',
          nextRoundInputPath: '/tmp/next.md',
          redTestResultPath: '/tmp/red.json',
        },
      }
    )).toBe(true)

    expect(isRecoverableHarnessSession(failedHarnessSession, null)).toBe(false)
  })
})

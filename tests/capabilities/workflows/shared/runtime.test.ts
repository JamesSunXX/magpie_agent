import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkflowFailure,
  appendWorkflowEvent,
  buildCommandSafetyConfig,
  classifyDangerousCommand,
  evaluateToolPermission,
  evaluateCommandPermission,
  ensureSessionScopedDirectories,
  generateWorkflowId,
  isRecoverableHarnessSession,
  isRecoverableLoopSession,
  listWorkflowSessions,
  loadWorkflowSession,
  parseCommandArgs,
  persistWorkflowSession,
  resolveExecutionIsolationContext,
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

  it('creates session-scoped workspace directories and only clears temp on reset', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-scoped-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-scoped-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    const first = await ensureSessionScopedDirectories(cwd, 'harness', 'harness-a')
    expect(existsSync(first.workspaceDir)).toBe(true)
    expect(existsSync(first.uploadsDir)).toBe(true)
    expect(existsSync(first.outputsDir)).toBe(true)
    expect(existsSync(first.tempDir)).toBe(true)

    writeFileSync(join(first.workspaceDir, 'workspace.keep'), 'keep', 'utf-8')
    writeFileSync(join(first.tempDir, 'temp.delete'), 'delete', 'utf-8')

    const second = await ensureSessionScopedDirectories(cwd, 'harness', 'harness-a', { clearTemp: true })
    expect(second).toEqual(first)
    expect(existsSync(join(second.workspaceDir, 'workspace.keep'))).toBe(true)
    expect(existsSync(join(second.tempDir, 'temp.delete'))).toBe(false)
  })

  it('resolves a disabled execution isolation context to the current workspace', () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-isolation-disabled-'))

    const context = resolveExecutionIsolationContext({
      cwd,
      capability: 'loop',
      sessionId: 'loop-a',
      config: { enabled: false, mode: 'worktree' },
    })

    expect(context).toMatchObject({
      enabled: false,
      mode: 'disabled',
      workspaceMode: 'current',
      workspacePath: cwd,
      recoveryPath: cwd,
    })
  })

  it('resolves a worktree execution isolation context under the session workspace', () => {
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-isolation-worktree-'))

    const context = resolveExecutionIsolationContext({
      cwd,
      capability: 'harness',
      sessionId: 'harness-a',
      config: { enabled: true, mode: 'worktree' },
    })

    expect(context).toMatchObject({
      enabled: true,
      mode: 'worktree',
      workspaceMode: 'worktree',
      recoveryPath: context.workspacePath,
    })
    expect(context.workspacePath).toContain(join('.magpie', 'sessions', 'harness', 'harness-a', 'workspace'))
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

  it('persists workflow failure artifacts through the shared helper', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-failures-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-failures-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    const result = await appendWorkflowFailure(cwd, {
      capability: 'harness',
      sessionId: 'harness-a',
      stage: 'reviewing',
      reason: 'Review cycle timed out',
      rawError: 'spawnSync codex ETIMEDOUT',
      evidencePaths: ['/tmp/review.json'],
      lastReliablePoint: 'review_completed',
    })

    expect(result.record.category).toBe('transient')
    expect(result.recordPath).toContain('/failures/')
    expect(result.indexPath).toBe(join(cwd, '.magpie', 'failure-index.json'))
    expect(readFileSync(result.indexPath, 'utf-8')).toContain('"count": 1')
  })

  it('reuses the source failure signature for derived failures without incrementing the index twice', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-runtime-derived-failures-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-runtime-derived-failures-cwd-'))
    process.env.MAGPIE_HOME = magpieHome

    await appendWorkflowFailure(cwd, {
      capability: 'loop',
      sessionId: 'loop-a',
      stage: 'code_development',
      reason: 'Loop failed on resume checkpoint',
      rawError: 'Cannot safely resume because no reliable checkpoint was recorded.',
      evidencePaths: ['/tmp/loop-events.jsonl'],
      lastReliablePoint: 'planning_completed',
      metadata: {
        checkpointMissing: true,
      },
    })

    const result = await appendWorkflowFailure(cwd, {
      capability: 'harness',
      sessionId: 'harness-a',
      stage: 'developing',
      reason: 'Harness failed because the inner loop failed.',
      rawError: 'Loop failed during code_development.',
      evidencePaths: ['/tmp/harness-events.jsonl'],
      lastReliablePoint: 'planning_completed',
      metadata: {
        sourceFailureSignature: 'loop|code_development|workflow_defect|cannot safely resume because no reliable checkpoint was recorded.',
        countTowardFailureIndex: false,
      },
    })

    const index = JSON.parse(readFileSync(result.indexPath, 'utf-8')) as {
      entries: Array<{
        signature: string
        count: number
        capabilities: Record<string, number>
      }>
    }

    expect(result.record.signature).toBe(
      'code_development|workflow_defect|cannot safely resume because no reliable checkpoint was recorded.'
    )
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({
      signature: 'code_development|workflow_defect|cannot safely resume because no reliable checkpoint was recorded.',
      count: 1,
      capabilities: {
        loop: 1,
      },
    })
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
    expect(blocked.output).toContain('allow_dangerous_commands: true')
  })

  it('still blocks dangerous commands unless explicit allow is enabled', () => {
    expect(classifyDangerousCommand('rm -rf dist', buildCommandSafetyConfig({
      require_confirmation_for_dangerous: false,
    }))).toContain('rm -rf')
  })

  it('allows dangerous pattern matching to be disabled after explicit allow', () => {
    expect(classifyDangerousCommand('rm -rf dist', buildCommandSafetyConfig({
      allow_dangerous_commands: true,
      require_confirmation_for_dangerous: false,
    }))).toBeNull()
  })

  it('applies explicit command permission policy before running commands', () => {
    const safety = buildCommandSafetyConfig({
      permission_policy: {
        command_categories: {
          write: 'confirm',
        },
        denied_path_patterns: ['~/.ssh'],
      },
    })

    expect(evaluateCommandPermission('cp key ~/.ssh/id_rsa', safety)).toMatchObject({
      action: 'deny',
      category: 'path',
      matchedRule: '~/.ssh',
    })
    expect(evaluateCommandPermission('touch output.txt', safety)).toMatchObject({
      action: 'confirm',
      category: 'write',
    })

    const blocked = runSafeCommand(process.cwd(), 'cp key ~/.ssh/id_rsa', {
      safety,
      interactive: false,
    })

    expect(blocked.passed).toBe(false)
    expect(blocked.output).toContain('Command blocked by permission policy')
    expect(blocked.output).toContain('~/.ssh')
  })

  it('applies tool category permission policy', () => {
    const safety = buildCommandSafetyConfig({
      permission_policy: {
        tool_categories: {
          im: 'deny',
          operations: 'confirm',
        },
      },
    })

    expect(evaluateToolPermission('im', safety)).toMatchObject({
      action: 'deny',
      category: 'im',
      matchedRule: 'im',
    })
    expect(evaluateToolPermission('operations', safety)).toMatchObject({
      action: 'confirm',
      category: 'operations',
      matchedRule: 'operations',
    })
    expect(evaluateToolPermission('api', safety)).toMatchObject({
      action: 'allow',
      category: 'api',
    })
  })

  it('terminates a command that exceeds the configured runtime timeout', () => {
    const result = runSafeCommand(
      process.cwd(),
      'node -e "setInterval(function(){}, 1000)"',
      { timeoutMs: 50 }
    )

    expect(result.passed).toBe(false)
    expect(result.output.toLowerCase()).toContain('timed out')
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
      reworkOrigin: 'verification',
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

  it('treats a failed integration rework stage with saved artifacts as recoverable', () => {
    expect(isRecoverableLoopSession({
      status: 'failed',
      currentStageIndex: 0,
      stages: ['integration_test'],
      reworkOrigin: 'integration',
      lastReliablePoint: 'constraints_validated',
      artifacts: {
        workspacePath: '/tmp/workspace',
        nextRoundInputPath: '/tmp/next.md',
      },
      stageResults: [{
        stage: 'integration_test',
        success: false,
        confidence: 0.4,
        summary: 'Integration verification failed and needs another pass.',
        risks: ['rerun after fixing the environment drift'],
        retryCount: 0,
        artifacts: ['/tmp/integration-test.md'],
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

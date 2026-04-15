import { mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { StateManager } from '../../../src/state/state-manager.js'
import { handleConfirmationAction } from '../../../src/platform/integrations/im/feishu/confirmation-bridge.js'

async function createPausedLoopSession(cwd: string, sessionId: string, confirmationId: string) {
  const state = new StateManager(cwd)
  await state.initLoopSessions()
  const loopSessionDir = join(cwd, '.magpie', 'sessions', 'loop', sessionId)
  mkdirSync(loopSessionDir, { recursive: true })
  const confirmationPath = join(loopSessionDir, 'human_confirmation.md')
  writeFileSync(confirmationPath, `# Human Confirmation Queue

<!-- MAGPIE_HUMAN_CONFIRMATION_START -->

\`\`\`yaml
id: ${confirmationId}
session_id: ${sessionId}
stage: code_development
status: pending
decision: pending
reason: Need one final decision
next_action: Approve or reject
created_at: 2026-04-15T00:00:00.000Z
updated_at: 2026-04-15T00:00:00.000Z
\`\`\`
<!-- MAGPIE_HUMAN_CONFIRMATION_END -->
`, 'utf-8')

  await state.saveLoopSession({
    id: sessionId,
    title: 'Loop',
    goal: 'Ship checkout',
    prdPath: '/tmp/prd.md',
    createdAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-15T00:05:00.000Z'),
    status: 'paused_for_human',
    currentStageIndex: 0,
    stages: ['code_development'],
    plan: [],
    stageResults: [],
    humanConfirmations: [{
      id: confirmationId,
      sessionId,
      stage: 'code_development',
      status: 'pending',
      decision: 'pending',
      reason: 'Need one final decision',
      artifacts: [],
      nextAction: 'Approve or reject',
      createdAt: new Date('2026-04-15T00:00:00.000Z'),
      updatedAt: new Date('2026-04-15T00:00:00.000Z'),
    }],
    artifacts: {
      sessionDir: loopSessionDir,
      eventsPath: join(loopSessionDir, 'events.jsonl'),
      planPath: join(loopSessionDir, 'plan.json'),
      humanConfirmationPath: confirmationPath,
    },
  })

  return { state, confirmationPath }
}

describe('handleConfirmationAction', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('approves a pending confirmation when the actor is whitelisted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-im-confirm-'))
    dirs.push(cwd)
    const { state } = await createPausedLoopSession(cwd, 'loop-123', 'confirm-1')

    const result = await handleConfirmationAction(cwd, {
      actorOpenId: 'ou_approved_user',
      whitelist: ['ou_approved_user'],
      action: 'approve_confirmation',
      sessionId: 'loop-123',
      confirmationId: 'confirm-1',
      threadKey: 'om_root',
      chatId: 'oc_chat',
      extraInstruction: 'Run smoke test before merge.',
    })

    expect(result.status).toBe('applied')
    expect(result.decision).toBe('approved')

    const saved = await state.loadLoopSession('loop-123')
    expect(saved?.humanConfirmations[0]?.decision).toBe('approved')
    expect(saved?.humanConfirmations[0]?.rationale).toContain('Run smoke test before merge.')
  })

  it('rejects unauthorized confirmation actions without mutating session state', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-im-confirm-'))
    dirs.push(cwd)
    const { state } = await createPausedLoopSession(cwd, 'loop-456', 'confirm-2')

    const result = await handleConfirmationAction(cwd, {
      actorOpenId: 'ou_guest',
      whitelist: ['ou_operator'],
      action: 'approve_confirmation',
      sessionId: 'loop-456',
      confirmationId: 'confirm-2',
      threadKey: 'om_root',
      chatId: 'oc_chat',
    })

    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('not allowed')

    const saved = await state.loadLoopSession('loop-456')
    expect(saved?.humanConfirmations[0]?.decision).toBe('pending')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildRoleRoster,
  createRoleMessage,
  createRoleRoundResult,
  getRoleArtifactPaths,
  isRoleMessage,
  resolveRoleBindings,
  serializeRoleMessage,
} from '../../src/core/index.js'

describe('core role helpers', () => {
  it('normalizes bindings and builds a role roster', () => {
    const bindings = resolveRoleBindings({
      architect: { model: 'gpt-4.1' },
      developer: { tool: 'codex' },
      reviewers: [{ tool: 'claude-code' }],
      arbitrator: { tool: 'kiro' },
      namedReviewers: {
        security: { model: 'o3' },
      },
    })

    expect(bindings.namedReviewers.security).toEqual({ model: 'o3' })

    const roster = buildRoleRoster(bindings)
    expect(roster.map((role) => role.roleId)).toEqual([
      'architect',
      'developer',
      'reviewer-1',
      'arbitrator',
    ])
  })

  it('creates and serializes a role message', () => {
    const message = createRoleMessage({
      sessionId: 'loop-1',
      roundId: 'round-1',
      fromRole: 'architect',
      toRole: 'developer',
      kind: 'plan_request',
      summary: 'Start implementation.',
      artifactRefs: [{ path: '/tmp/plan.json', label: 'plan' }],
    })

    expect(isRoleMessage(message)).toBe(true)
    expect(JSON.parse(serializeRoleMessage(message))).toMatchObject({
      sessionId: 'loop-1',
      roundId: 'round-1',
      fromRole: 'architect',
      toRole: 'developer',
      kind: 'plan_request',
    })
  })

  it('dedupes open issues and trims next-round brief', () => {
    const round = createRoleRoundResult({
      roundId: 'cycle-1',
      roles: [],
      reviewResults: [],
      openIssues: [
        {
          id: 'rollback',
          title: 'Missing rollback handling',
          severity: 'high',
          sourceRole: 'reviewer-1',
          category: 'review',
          evidencePath: '/tmp/review.json',
          requiredAction: 'Add rollback handling.',
          status: 'open',
        },
        {
          id: 'rollback',
          title: 'Missing rollback handling',
          severity: 'high',
          sourceRole: 'reviewer-1',
          category: 'review',
          evidencePath: '/tmp/review.json',
          requiredAction: 'Add rollback handling.',
          status: 'open',
        },
      ],
      nextRoundBrief: '  Fix rollback handling before rerun.  ',
      finalAction: 'revise',
    })

    expect(round.openIssues).toHaveLength(1)
    expect(round.nextRoundBrief).toBe('Fix rollback handling before rerun.')
  })

  it('builds stable artifact paths', () => {
    expect(getRoleArtifactPaths('/tmp/session-1')).toEqual({
      rolesPath: '/tmp/session-1/roles.json',
      messagesPath: '/tmp/session-1/messages.jsonl',
      roundsDir: '/tmp/session-1/rounds',
    })
  })
})

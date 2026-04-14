import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { loadGraphWorkbench } from '../../src/tui/graph-workbench-loader.js'

describe('graph workbench loader', () => {
  it('loads graph overview, selected node detail, actions, attention, and recent events', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'harness-graph-1')
    const loopDir = join(repoDir, '.magpie', 'sessions', 'loop', 'loop-ship')
    const graphPath = join(harnessDir, 'graph.json')
    const eventsPath = join(harnessDir, 'events.jsonl')
    const knowledgeStatePath = join(loopDir, 'knowledge', 'state.json')

    mkdirSync(join(harnessDir, 'rounds'), { recursive: true })
    mkdirSync(join(loopDir, 'knowledge'), { recursive: true })

    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'harness-graph-1',
      capability: 'harness',
      title: 'Checkout graph',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Waiting for release approval.',
      artifacts: {
        graphPath,
        eventsPath,
      },
    }), 'utf-8')

    writeFileSync(graphPath, JSON.stringify({
      version: 1,
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'active',
      approvalGates: [],
      rollup: {
        total: 3,
        pending: 0,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 1,
        blocked: 1,
        completed: 1,
        failed: 0,
      },
      nodes: [
        {
          id: 'design-api',
          title: 'Design API',
          goal: 'Lock the API contract',
          type: 'feature',
          dependencies: [],
          state: 'completed',
          riskMarkers: [],
          approvalGates: [],
        },
        {
          id: 'release-approval',
          title: 'Release approval',
          goal: 'Approve release',
          type: 'approval',
          dependencies: ['design-api'],
          state: 'waiting_approval',
          riskMarkers: [],
          approvalGates: [
            {
              gateId: 'approve-release',
              label: 'Approve release',
              scope: 'before_dispatch',
              status: 'pending',
            },
          ],
          execution: {
            capability: 'loop',
            sessionId: 'loop-ship',
          },
          statusReason: 'Waiting for node approval: Approve release',
        },
        {
          id: 'deploy-ui',
          title: 'Deploy UI',
          goal: 'Deploy checkout UI',
          type: 'feature',
          dependencies: ['release-approval'],
          state: 'blocked',
          riskMarkers: [],
          approvalGates: [],
          statusReason: 'Blocked by dependency: release-approval',
        },
      ],
    }), 'utf-8')

    writeFileSync(join(loopDir, 'session.json'), JSON.stringify({
      id: 'loop-ship',
      title: 'Ship checkout release',
      goal: 'Ship checkout release',
      prdPath: '/tmp/prd.md',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:05:00.000Z',
      status: 'paused_for_human',
      currentStageIndex: 2,
      stages: ['prd_review', 'planning', 'implementation'],
      plan: [],
      stageResults: [
        {
          stage: 'implementation',
          summary: 'Implementation is ready. Waiting for release approval.',
          status: 'completed',
          startedAt: '2026-03-19T11:40:00.000Z',
          completedAt: '2026-03-19T12:00:00.000Z',
        },
      ],
      humanConfirmations: [],
      artifacts: {
        sessionDir: loopDir,
        knowledgeStatePath,
      },
    }), 'utf-8')

    writeFileSync(knowledgeStatePath, JSON.stringify({
      currentStage: 'implementation',
      lastReliableResult: 'Implementation is ready. Waiting for release approval.',
      nextAction: 'Ask the operator to approve the release gate.',
      currentBlocker: 'Release approval is still pending.',
      updatedAt: '2026-03-19T12:05:00.000Z',
    }), 'utf-8')

    writeFileSync(eventsPath, [
      JSON.stringify({
        timestamp: '2026-03-19T11:40:00.000Z',
        type: 'workflow_started',
        stage: 'queued',
        summary: 'Harness workflow started.',
      }),
      JSON.stringify({
        timestamp: '2026-03-19T11:45:00.000Z',
        type: 'stage_changed',
        stage: 'reviewing',
        summary: 'Running review cycle 1.',
      }),
      JSON.stringify({
        timestamp: '2026-03-19T11:55:00.000Z',
        type: 'cycle_completed',
        stage: 'reviewing',
        cycle: 1,
        summary: 'Cycle 1 requested more changes.',
      }),
      JSON.stringify({
        timestamp: '2026-03-19T12:00:00.000Z',
        type: 'graph_approval_recorded',
        stage: 'reviewing',
        summary: 'Rejected graph node gate for release-approval.',
        details: {
          graphId: 'checkout-v2',
          decision: 'rejected',
          nodeId: 'release-approval',
          gateId: 'approve-release',
        },
      }),
      '',
    ].join('\n'), 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'harness-graph-1',
    })

    expect(workbench.error).toBeUndefined()
    expect(workbench.graph).toMatchObject({
      sessionId: 'harness-graph-1',
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      status: 'active',
      rollup: {
        ready: 0,
        waitingApproval: 1,
        blocked: 1,
      },
    })
    expect(workbench.nodes.map((node) => node.id)).toEqual(['design-api', 'release-approval', 'deploy-ui'])
    expect(workbench.selectedNode).toMatchObject({
      id: 'release-approval',
      title: 'Release approval',
      type: 'approval',
      state: 'waiting_approval',
      statusReason: 'Waiting for node approval: Approve release',
      dependencies: ['design-api'],
      approvalPending: true,
      latestSummary: 'Implementation is ready. Waiting for release approval.',
      nextStep: 'Ask the operator to approve the release gate.',
      linkedExecution: {
        capability: 'loop',
        sessionId: 'loop-ship',
        status: 'paused_for_human',
        summary: 'Implementation is ready. Waiting for release approval.',
        nextStep: 'Ask the operator to approve the release gate.',
        command: ['loop', 'resume', 'loop-ship'],
      },
    })
    expect(workbench.actions).toEqual([
      {
        id: 'approve:node:release-approval:approve-release',
        kind: 'approve',
        label: 'Approve release',
        description: 'Approve pending gate for release-approval.',
        command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
        requiresConfirmation: false,
      },
      {
        id: 'reject:node:release-approval:approve-release',
        kind: 'reject',
        label: 'Reject release',
        description: 'Reject pending gate for release-approval.',
        command: ['harness', 'reject', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
        requiresConfirmation: true,
      },
      {
        id: 'jump:loop:loop-ship',
        kind: 'jump',
        label: 'Open linked loop session',
        description: 'Resume linked loop session loop-ship.',
        command: ['loop', 'resume', 'loop-ship'],
        requiresConfirmation: false,
      },
    ])
    expect(workbench.attention).toEqual([
      'Waiting approval: release-approval - Waiting for node approval: Approve release',
      'Blocked: deploy-ui - Blocked by dependency: release-approval',
    ])
    expect(workbench.events).toEqual([
      {
        id: '2026-03-19T12:00:00.000Z:graph_approval_recorded:3',
        timestamp: '2026-03-19T12:00:00.000Z',
        summary: 'Approval rejected for release-approval.',
      },
      {
        id: '2026-03-19T11:55:00.000Z:cycle_completed:2',
        timestamp: '2026-03-19T11:55:00.000Z',
        summary: 'Cycle 1 requested more changes.',
      },
      {
        id: '2026-03-19T11:45:00.000Z:stage_changed:1',
        timestamp: '2026-03-19T11:45:00.000Z',
        summary: 'Stage changed: reviewing. Running review cycle 1.',
      },
      {
        id: '2026-03-19T11:40:00.000Z:workflow_started:0',
        timestamp: '2026-03-19T11:40:00.000Z',
        summary: 'Workflow started.',
      },
    ])
  })

  it('returns a compact error state when the harness session has no graph artifact', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'harness-graph-missing')

    mkdirSync(harnessDir, { recursive: true })
    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'harness-graph-missing',
      capability: 'harness',
      title: 'Missing graph',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Graph has not been persisted yet.',
      artifacts: {},
    }), 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'harness-graph-missing',
    })

    expect(workbench.error).toBe('Graph artifact is not available for this session.')
    expect(workbench.nodes).toEqual([])
    expect(workbench.actions).toEqual([])
    expect(workbench.events).toEqual([])
  })

  it('fails gracefully when the graph artifact is malformed and still shows recent events', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'harness-graph-bad')
    const graphPath = join(harnessDir, 'graph.json')
    const eventsPath = join(harnessDir, 'events.jsonl')

    mkdirSync(harnessDir, { recursive: true })

    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'harness-graph-bad',
      capability: 'harness',
      title: 'Broken graph',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Graph is broken.',
      artifacts: {
        graphPath,
        eventsPath,
      },
    }), 'utf-8')

    writeFileSync(graphPath, '{bad json', 'utf-8')
    writeFileSync(eventsPath, `${JSON.stringify({
      timestamp: '2026-03-19T12:00:00.000Z',
      type: 'workflow_failed',
      stage: 'reviewing',
      summary: 'Harness workflow failed.',
    })}\n`, 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'harness-graph-bad',
    })

    expect(workbench.error).toBe('Graph artifact could not be read.')
    expect(workbench.events).toEqual([
      {
        id: '2026-03-19T12:00:00.000Z:workflow_failed:0',
        timestamp: '2026-03-19T12:00:00.000Z',
        summary: 'Harness workflow failed.',
      },
    ])
  })

  it('builds jump actions for linked harness sessions using existing entrypoints', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'parent-graph')
    const linkedHarnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'child-harness')
    const graphPath = join(harnessDir, 'graph.json')

    mkdirSync(harnessDir, { recursive: true })
    mkdirSync(linkedHarnessDir, { recursive: true })

    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'parent-graph',
      capability: 'harness',
      title: 'Parent graph',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'in_progress',
      currentStage: 'reviewing',
      summary: 'Reviewing child harness result.',
      artifacts: {
        graphPath,
      },
    }), 'utf-8')

    writeFileSync(join(linkedHarnessDir, 'session.json'), JSON.stringify({
      id: 'child-harness',
      capability: 'harness',
      title: 'Child harness',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'in_progress',
      currentStage: 'developing',
      summary: 'Child harness is still running.',
      artifacts: {},
    }), 'utf-8')

    writeFileSync(graphPath, JSON.stringify({
      version: 1,
      graphId: 'parent-graph',
      title: 'Parent graph',
      goal: 'Coordinate child work',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'active',
      approvalGates: [],
      rollup: {
        total: 1,
        pending: 0,
        ready: 1,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'child-node',
          title: 'Child node',
          goal: 'Run child harness',
          type: 'feature',
          dependencies: [],
          state: 'ready',
          riskMarkers: [],
          approvalGates: [],
          execution: {
            capability: 'harness',
            sessionId: 'child-harness',
          },
        },
      ],
    }), 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'parent-graph',
    })

    expect(workbench.selectedNode?.linkedExecution).toMatchObject({
      capability: 'harness',
      sessionId: 'child-harness',
      status: 'in_progress',
      summary: 'Child harness is still running.',
      command: ['harness', 'attach', 'child-harness', '--once'],
    })
    expect(workbench.actions.at(-1)).toEqual({
      id: 'jump:harness:child-harness',
      kind: 'jump',
      label: 'Open linked harness session',
      description: 'Inspect linked harness session child-harness.',
      command: ['harness', 'attach', 'child-harness', '--once'],
      requiresConfirmation: false,
    })
  })

  it('surfaces graph-level approval gates as direct workbench actions', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'graph-gate-session')
    const graphPath = join(harnessDir, 'graph.json')

    mkdirSync(harnessDir, { recursive: true })

    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'graph-gate-session',
      capability: 'harness',
      title: 'Graph gate session',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Waiting for graph confirmation.',
      artifacts: {
        graphPath,
      },
    }), 'utf-8')

    writeFileSync(graphPath, JSON.stringify({
      version: 1,
      graphId: 'graph-gate',
      title: 'Graph gate',
      goal: 'Wait for graph approval',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      approvalGates: [
        {
          gateId: 'confirm-graph',
          label: 'Confirm graph',
          scope: 'graph_confirmation',
          status: 'pending',
        },
      ],
      rollup: {
        total: 1,
        pending: 1,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 1,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'blocked-node',
          title: 'Blocked node',
          goal: 'Wait for graph gate',
          type: 'feature',
          dependencies: [],
          state: 'blocked',
          riskMarkers: [],
          approvalGates: [],
          statusReason: 'Blocked by graph approval: Confirm graph',
        },
      ],
    }), 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'graph-gate-session',
    })

    expect(workbench.actions).toEqual([
      {
        id: 'approve:graph:confirm-graph',
        kind: 'approve',
        label: 'Confirm graph',
        description: 'Approve pending graph gate.',
        command: ['harness', 'approve', 'graph-gate-session', '--gate', 'confirm-graph'],
        requiresConfirmation: false,
      },
      {
        id: 'reject:graph:confirm-graph',
        kind: 'reject',
        label: 'Reject graph',
        description: 'Reject pending graph gate.',
        command: ['harness', 'reject', 'graph-gate-session', '--gate', 'confirm-graph'],
        requiresConfirmation: true,
      },
    ])
  })

  it('loads unresolved issues from linked harness role rounds', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-workbench-repo-'))
    const harnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'parent-harness')
    const graphPath = join(harnessDir, 'graph.json')
    const childHarnessDir = join(repoDir, '.magpie', 'sessions', 'harness', 'child-review')
    const roleRoundsDir = join(childHarnessDir, 'rounds')

    mkdirSync(harnessDir, { recursive: true })
    mkdirSync(roleRoundsDir, { recursive: true })

    writeFileSync(join(harnessDir, 'session.json'), JSON.stringify({
      id: 'parent-harness',
      capability: 'harness',
      title: 'Parent harness',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Waiting on child review fixes.',
      artifacts: {
        graphPath,
      },
    }), 'utf-8')

    writeFileSync(join(childHarnessDir, 'session.json'), JSON.stringify({
      id: 'child-review',
      capability: 'harness',
      title: 'Child review',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'blocked',
      currentStage: 'reviewing',
      summary: 'Need another review cycle.',
      artifacts: {
        roleRoundsDir,
      },
    }), 'utf-8')

    writeFileSync(join(roleRoundsDir, 'cycle-1.json'), JSON.stringify({
      finalAction: 'revise',
      openIssues: [
        { title: 'Missing rollback handling', severity: 'high', sourceRole: 'reviewer-1' },
        { title: 'No retry limit', severity: 'medium', sourceRole: 'reviewer-2' },
      ],
    }), 'utf-8')

    writeFileSync(graphPath, JSON.stringify({
      version: 1,
      graphId: 'parent-harness',
      title: 'Parent harness',
      goal: 'Follow child review status',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T12:00:00.000Z',
      status: 'active',
      approvalGates: [],
      rollup: {
        total: 1,
        pending: 0,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 1,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'child-review-node',
          title: 'Child review node',
          goal: 'Track child review',
          type: 'feature',
          dependencies: [],
          state: 'blocked',
          riskMarkers: [],
          approvalGates: [],
          execution: {
            capability: 'harness',
            sessionId: 'child-review',
          },
          statusReason: 'Blocked by child review issues',
        },
      ],
    }), 'utf-8')

    const workbench = await loadGraphWorkbench({
      cwd: repoDir,
      sessionId: 'parent-harness',
    })

    expect(workbench.selectedNode?.unresolvedIssues).toEqual([
      '[high] reviewer-1: Missing rollback handling',
      '[medium] reviewer-2: No retry limit',
    ])
  })
})

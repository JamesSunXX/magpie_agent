import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createHarnessGraphArtifact,
  loadHarnessGraphArtifact,
  persistHarnessGraphArtifact,
  reconcileHarnessGraphArtifact,
} from '../../../src/capabilities/workflows/harness-server/graph.js'

describe('harness graph artifact runtime', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists and reloads a repo-local graph artifact with rollups', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-harness-graph-'))
    tempDirs.push(cwd)

    const graph = createHarnessGraphArtifact({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a coordinated graph',
      sourceRequirementPath: 'docs/plans/2026-04-13-milestone-4-graph-execution-and-workbench.md',
      nodes: [
        {
          id: 'design-api',
          title: 'Design API',
          goal: 'Lock the API contract',
          type: 'feature',
          state: 'completed',
        },
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build the checkout screens',
          type: 'feature',
          dependencies: ['design-api'],
          state: 'ready',
          conflictScope: 'src/checkout',
          riskMarkers: ['touches-checkout-ui'],
        },
        {
          id: 'release-approval',
          title: 'Release approval',
          goal: 'Confirm the rollout is safe',
          type: 'approval',
          dependencies: ['build-ui'],
          state: 'waiting_approval',
          approvalGates: [
            {
              gateId: 'approve-rollout',
              label: 'Approve rollout',
              scope: 'before_dispatch',
              status: 'pending',
            },
          ],
        },
      ],
      approvalGates: [
        {
          gateId: 'graph-confirmation',
          label: 'Confirm graph',
          scope: 'graph_confirmation',
          status: 'approved',
          decidedAt: '2026-04-13T00:00:00.000Z',
          decidedBy: 'operator',
        },
      ],
    })

    const path = await persistHarnessGraphArtifact(cwd, 'harness-graph-1', graph)
    const loaded = await loadHarnessGraphArtifact(cwd, 'harness-graph-1')

    expect(path.endsWith(join('.magpie', 'sessions', 'harness', 'harness-graph-1', 'graph.json'))).toBe(true)
    expect(loaded).toMatchObject({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      status: 'active',
      rollup: {
        total: 3,
        pending: 0,
        ready: 1,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 1,
        blocked: 0,
        completed: 1,
        failed: 0,
      },
      nodes: [
        { id: 'design-api', dependencies: [], state: 'completed' },
        { id: 'build-ui', dependencies: ['design-api'], state: 'ready' },
        { id: 'release-approval', dependencies: ['build-ui'], state: 'waiting_approval' },
      ],
    })
    expect(readFileSync(path, 'utf-8')).toContain('"graphId": "checkout-v2"')
  })

  it('rejects duplicate IDs, missing dependencies, and dependency cycles', () => {
    expect(() => createHarnessGraphArtifact({
      graphId: 'duplicate-node',
      title: 'Duplicate node graph',
      goal: 'Reject duplicate IDs',
      nodes: [
        { id: 'node-a', title: 'A', goal: 'A', type: 'feature' },
        { id: 'node-a', title: 'B', goal: 'B', type: 'feature' },
      ],
    })).toThrow('Harness graph node IDs must be unique: node-a')

    expect(() => createHarnessGraphArtifact({
      graphId: 'missing-dependency',
      title: 'Missing dependency graph',
      goal: 'Reject missing dependencies',
      nodes: [
        {
          id: 'node-b',
          title: 'B',
          goal: 'B',
          type: 'feature',
          dependencies: ['node-a'],
        },
      ],
    })).toThrow('Harness graph dependency refers to unknown node: node-b -> node-a')

    expect(() => createHarnessGraphArtifact({
      graphId: 'dependency-cycle',
      title: 'Cyclic graph',
      goal: 'Reject cycles',
      nodes: [
        {
          id: 'node-a',
          title: 'A',
          goal: 'A',
          type: 'feature',
          dependencies: ['node-b'],
        },
        {
          id: 'node-b',
          title: 'B',
          goal: 'B',
          type: 'feature',
          dependencies: ['node-a'],
        },
      ],
    })).toThrow('Harness graph contains a dependency cycle: node-a -> node-b -> node-a')
  })

  it('derives blocked and completed graph statuses from persisted node states', () => {
    const blocked = createHarnessGraphArtifact({
      graphId: 'blocked-graph',
      title: 'Blocked graph',
      goal: 'Show blocked status',
      nodes: [
        { id: 'node-a', title: 'A', goal: 'A', type: 'feature', state: 'completed' },
        { id: 'node-b', title: 'B', goal: 'B', type: 'feature', dependencies: ['node-a'], state: 'blocked' },
      ],
    })
    const completed = createHarnessGraphArtifact({
      graphId: 'completed-graph',
      title: 'Completed graph',
      goal: 'Show completed status',
      nodes: [
        { id: 'node-a', title: 'A', goal: 'A', type: 'feature', state: 'completed' },
      ],
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.rollup.blocked).toBe(1)
    expect(completed.status).toBe('completed')
    expect(completed.rollup.completed).toBe(1)
  })

  it('reconciles dependency, approval, and conflict-scope readiness', () => {
    const graph = reconcileHarnessGraphArtifact(createHarnessGraphArtifact({
      graphId: 'dispatch-graph',
      title: 'Dispatch graph',
      goal: 'Show graph readiness',
      approvalGates: [
        {
          gateId: 'confirm-graph',
          label: 'Confirm graph',
          scope: 'graph_confirmation',
          status: 'approved',
        },
      ],
      nodes: [
        {
          id: 'node-a',
          title: 'Node A',
          goal: 'Complete base work',
          type: 'feature',
          state: 'completed',
          conflictScope: 'checkout',
        },
        {
          id: 'node-b',
          title: 'Node B',
          goal: 'Ready after dependency',
          type: 'feature',
          dependencies: ['node-a'],
          state: 'pending',
        },
        {
          id: 'node-c',
          title: 'Node C',
          goal: 'Waiting for graph approval',
          type: 'approval',
          state: 'pending',
          approvalGates: [
            {
              gateId: 'approve-dispatch',
              label: 'Approve dispatch',
              scope: 'before_dispatch',
              status: 'pending',
            },
          ],
        },
        {
          id: 'node-d',
          title: 'Node D',
          goal: 'Currently running',
          type: 'feature',
          state: 'running',
          conflictScope: 'payments',
        },
        {
          id: 'node-e',
          title: 'Node E',
          goal: 'Blocked by conflict scope',
          type: 'feature',
          dependencies: ['node-a'],
          state: 'pending',
          conflictScope: 'payments',
        },
      ],
    }))

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node-b', state: 'ready' }),
      expect.objectContaining({ id: 'node-c', state: 'waiting_approval' }),
      expect.objectContaining({ id: 'node-d', state: 'running' }),
      expect.objectContaining({ id: 'node-e', state: 'blocked' }),
    ]))
    expect(graph.rollup).toMatchObject({
      ready: 1,
      waitingApproval: 1,
      running: 1,
      blocked: 1,
      completed: 1,
    })
    expect(graph.status).toBe('active')
  })
})

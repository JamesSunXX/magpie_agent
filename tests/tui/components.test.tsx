import React from 'react'
import { describe, expect, it } from 'vitest'
import { CommandPreview } from '../../src/tui/components/command-preview.js'
import { Section } from '../../src/tui/components/common.js'
import { Dashboard, getVisibleSessionRows } from '../../src/tui/components/dashboard.js'
import { GraphWorkbench } from '../../src/tui/components/graph-workbench.js'
import { RunView } from '../../src/tui/components/run-view.js'
import { TaskWizard } from '../../src/tui/components/task-wizard.js'
import { getTaskDefinition } from '../../src/tui/tasks.js'

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }

  if (Array.isArray(node)) {
    return node.map((item) => collectText(item)).join(' ')
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (React.isValidElement(node)) {
    return collectText((node.props as { children?: unknown }).children)
  }

  return ''
}

function normalizedText(node: unknown): string {
  return collectText(node).replace(/\s+/g, ' ').trim()
}

describe('TUI components', () => {
  it('renders section and command preview copy', () => {
    const section = Section({ title: 'Summary', children: 'Body copy' })
    const preview = CommandPreview({
      command: {
        argv: ['review', '--local'],
        display: 'magpie review --local',
        summary: 'Review local changes',
      },
    })

    expect(normalizedText(section)).toContain('Body copy')
    expect(normalizedText(preview)).toContain('magpie review --local')
    expect(normalizedText(preview)).toContain('Review local changes')
  })

  it('renders the dashboard with tasks, sessions, and environment health', () => {
    const element = Dashboard({
      selectedIndex: 0,
      sessions: {
        continue: [
          {
            id: 'loop-1',
            capability: 'loop',
            title: 'Paused loop',
            status: 'paused_for_human',
            updatedAt: new Date('2026-03-19T10:00:00.000Z'),
            resumeCommand: ['loop', 'resume', 'loop-1'],
            artifactPaths: ['/tmp/human_confirmation.md'],
          },
        ],
        recent: [],
      },
      health: {
        items: [
          {
            key: 'config',
            label: 'Config',
            status: 'ok',
            detail: '/tmp/config.yaml',
          },
        ],
      },
    })

    expect(normalizedText(element)).toContain('Magpie Workbench')
    expect(normalizedText(element)).toContain('评审改动')
    expect(normalizedText(element)).toContain('Paused loop')
    expect(normalizedText(element)).toContain('/tmp/config.yaml')
  })

  it('renders loading and empty dashboard states', () => {
    const element = Dashboard({
      selectedIndex: 2,
      sessions: {
        continue: [],
        recent: [],
      },
    })

    expect(normalizedText(element)).toContain('No unfinished sessions.')
    expect(normalizedText(element)).toContain('Loading environment checks...')
  })

  it('renders recent sessions when present', () => {
    const element = Dashboard({
      selectedIndex: 5,
      sessions: {
        continue: [],
        recent: [
          {
            id: 'review-1',
            capability: 'review',
            title: 'Repo review',
            status: 'completed',
            updatedAt: new Date('2026-03-19T11:00:00.000Z'),
            resumeCommand: ['review', '--session', 'review-1'],
            artifactPaths: [],
          },
        ],
      },
      health: {
        items: [],
      },
    })

    expect(normalizedText(element)).toContain('Repo review')
    expect(normalizedText(element)).toContain('review-1')
  })

  it('renders the selected harness summary when a harness session is focused', () => {
    const element = Dashboard({
      selectedIndex: 5,
      sessions: {
        continue: [],
        recent: [
          {
            id: 'harness-1',
            capability: 'harness',
            title: 'Deliver checkout v2',
            detail: 'reviewing · 1=revise · dev+2 reviewers+arbitrator · revise: reviewer-1: Missing rollback handling · Fix rollback handling before rerun.',
            selectedDetail: {
              participants: 'developer, 2 reviewers, arbitrator',
              reviewerSummaries: [
                'security: revise - Missing rollback handling.',
                'qa: pass - No additional risks.',
              ],
              arbitration: 'Decision: revise - Need another cycle after rollback fixes.',
              nextStep: 'Fix rollback handling before rerun.',
              graphSummary: 'checkout-v2 · active · ready 0 · waiting approval 1 · blocked 1',
              attention: [
                'Approval needed: release-approval - Approve release. Waiting for node approval: Approve release. After approval: release-approval',
                'Blocked: deploy-ui - Blocked by dependency: release-approval',
              ],
              readyNow: 'No nodes are ready right now.',
              recommendedAction: 'Recommend approving release-approval first. Immediate unlock: release-approval.',
              recommendedCommand: 'magpie harness approve harness-1 --node release-approval --gate approve-release',
            },
            status: 'in_progress',
            updatedAt: new Date('2026-03-19T11:00:00.000Z'),
            resumeCommand: ['harness', 'attach', 'harness-1'],
            artifactPaths: [],
          },
        ],
      },
      health: {
        items: [],
      },
    })

    expect(normalizedText(element)).toContain('Participants: developer, 2 reviewers, arbitrator')
    expect(normalizedText(element)).toContain('security: revise - Missing rollback handling.')
    expect(normalizedText(element)).toContain('Decision: revise - Need another cycle after rollback fixes.')
    expect(normalizedText(element)).toContain('Next: Fix rollback handling before rerun.')
    expect(normalizedText(element)).toContain('Graph: checkout-v2 · active · ready 0 · waiting approval 1 · blocked 1')
    expect(normalizedText(element)).toContain('Approval needed: release-approval - Approve release. Waiting for node approval: Approve release. After approval: release-approval')
    expect(normalizedText(element)).toContain('Blocked: deploy-ui - Blocked by dependency: release-approval')
    expect(normalizedText(element)).toContain('Ready now: No nodes are ready right now.')
    expect(normalizedText(element)).toContain('Recommend: Recommend approving release-approval first. Immediate unlock: release-approval.')
    expect(normalizedText(element)).toContain('Command: magpie harness approve harness-1 --node release-approval --gate approve-release')
  })

  it('renders the graph workbench panels with selected node detail, actions, attention, and events', () => {
    const element = GraphWorkbench({
      workbench: {
        graph: {
          sessionId: 'harness-graph-1',
          graphId: 'checkout-v2',
          title: 'Checkout V2',
          status: 'active',
          rollup: {
            ready: 0,
            waitingApproval: 1,
            blocked: 1,
          },
        },
        nodes: [
          {
            id: 'design-api',
            title: 'Design API',
            type: 'feature',
            state: 'completed',
            approvalPending: false,
          },
          {
            id: 'release-approval',
            title: 'Release approval',
            type: 'approval',
            state: 'waiting_approval',
            statusReason: 'Waiting for node approval: Approve release',
            approvalPending: true,
          },
        ],
        selectedNodeId: 'release-approval',
        selectedNode: {
          id: 'release-approval',
          title: 'Release approval',
          type: 'approval',
          state: 'waiting_approval',
          statusReason: 'Waiting for node approval: Approve release',
          dependencies: ['design-api'],
          approvalPending: true,
          latestSummary: 'Implementation is ready. Waiting for release approval.',
          nextStep: 'Ask the operator to approve the release gate.',
          unresolvedIssues: [],
          linkedExecution: {
            capability: 'loop',
            sessionId: 'loop-ship',
            status: 'paused_for_human',
            summary: 'Implementation is ready. Waiting for release approval.',
            nextStep: 'Ask the operator to approve the release gate.',
            command: ['loop', 'resume', 'loop-ship'],
          },
        },
        actions: [
          {
            id: 'approve:node:release-approval:approve-release',
            kind: 'approve',
            label: 'Approve release',
            description: 'Approve pending gate for release-approval.',
            command: ['harness', 'approve', 'harness-graph-1', '--node', 'release-approval', '--gate', 'approve-release'],
            requiresConfirmation: false,
          },
          {
            id: 'jump:loop:loop-ship',
            kind: 'jump',
            label: 'Open linked loop session',
            description: 'Resume linked loop session loop-ship.',
            command: ['loop', 'resume', 'loop-ship'],
            requiresConfirmation: false,
          },
        ],
        attention: [
          'Waiting approval: release-approval - Waiting for node approval: Approve release',
          'Blocked: deploy-ui - Blocked by dependency: release-approval',
        ],
        events: [
          {
            id: 'evt-1',
            timestamp: '2026-03-19T12:00:00.000Z',
            summary: 'Approval rejected for release-approval.',
          },
        ],
      },
      focusedPanel: 'actions',
      selectedActionIndex: 0,
    })

    expect(normalizedText(element)).toContain('Graph Overview')
    expect(normalizedText(element)).toContain('Checkout V2')
    expect(normalizedText(element)).toContain('release-approval')
    expect(normalizedText(element)).toContain('Selected Node Detail')
    expect(normalizedText(element)).toContain('Implementation is ready. Waiting for release approval.')
    expect(normalizedText(element)).toContain('Linked session: loop loop-ship paused_for_human')
    expect(normalizedText(element)).toContain('Actions')
    expect(normalizedText(element)).toContain('Approve pending gate for release-approval.')
    expect(normalizedText(element)).toContain('Attention and Events')
    expect(normalizedText(element)).toContain('Approval rejected for release-approval.')
  })

  it('keeps session lists compact while browsing long history', () => {
    const recent = Array.from({ length: 16 }, (_, index) => ({
      id: `recent-${index + 1}`,
      capability: 'loop' as const,
      title: `Complete delivery flow item ${index + 1}`,
      status: 'completed',
      updatedAt: new Date(`2026-03-19T11:${String(index).padStart(2, '0')}:00.000Z`),
      resumeCommand: ['loop', 'resume', `recent-${index + 1}`],
      artifactPaths: [],
    }))

    const element = Dashboard({
      selectedIndex: 5 + 8,
      sessions: {
        continue: [],
        recent,
      },
      health: {
        items: [],
      },
    })

    expect(normalizedText(element)).toContain('Showing 12 of 16 recent sessions')
    expect(normalizedText(element)).toContain('2 more above')
    expect(normalizedText(element)).toContain('2 more below')
    expect(normalizedText(element)).toContain('Complete delivery flow item 9')
    expect(normalizedText(element)).not.toContain('Complete delivery flow item 2 Loop')
  })

  it('precomputes visible session rows with stable selection state', () => {
    const rows = getVisibleSessionRows(
      Array.from({ length: 6 }, (_, index) => ({
        id: `recent-${index + 1}`,
        capability: 'loop' as const,
        title: `Session ${index + 1}`,
        status: 'completed',
        updatedAt: new Date(`2026-03-19T11:${String(index).padStart(2, '0')}:00.000Z`),
        resumeCommand: ['loop', 'resume', `recent-${index + 1}`],
        artifactPaths: [],
      })),
      4,
      4
    )

    expect(rows.hiddenAbove).toBe(2)
    expect(rows.rows.map((row) => row.absoluteIndex)).toEqual([2, 3, 4, 5])
    expect(rows.rows.filter((row) => row.selected).map((row) => row.card.id)).toEqual(['recent-5'])
  })

  it('renders wizard fields and advanced status', () => {
    const task = getTaskDefinition('change-review')
    const element = TaskWizard({
      task,
      draft: {
        taskId: 'change-review',
        values: {
          mode: 'branch',
          branchBase: 'main',
          all: true,
        },
        showAdvanced: true,
      },
      fields: [
        task.fields[0],
        task.fields[1],
        task.fields[6],
      ],
      selectedIndex: 1,
      canSubmit: true,
    })

    expect(normalizedText(element)).toContain('Review mode')
    expect(normalizedText(element)).toContain('Base branch')
    expect(normalizedText(element)).toContain('main')
    expect(normalizedText(element)).toContain('Advanced:')
    expect(normalizedText(element)).toContain('shown')
  })

  it('renders run status, artifacts, and live logs', () => {
    const populated = RunView({
      run: {
        command: {
          argv: ['loop', 'run', 'Goal', '--prd', '/tmp/prd.md'],
          display: 'magpie loop run Goal --prd /tmp/prd.md',
          summary: 'Run a loop',
        },
        display: 'magpie loop run Goal --prd /tmp/prd.md',
        logs: ['first line\n', 'second line\n'],
        status: 'completed',
        exitCode: 0,
        sessionId: 'loop-1',
        artifacts: {
          plan: '/tmp/plan.md',
        },
      },
    })
    const empty = RunView({
      run: {
        command: {
          argv: ['review', '--local'],
          display: 'magpie review --local',
          summary: 'Review local changes',
        },
        display: 'magpie review --local',
        logs: [],
        status: 'running',
        artifacts: {},
      },
    })

    expect(normalizedText(populated)).toContain('/tmp/plan.md')
    expect(normalizedText(populated)).toContain('second line')
    expect(normalizedText(empty)).toContain('Waiting for output...')
    expect(normalizedText(empty)).toContain('No markers yet.')
  })
})

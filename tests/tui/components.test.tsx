import React from 'react'
import { describe, expect, it } from 'vitest'
import { CommandPreview } from '../../src/tui/components/command-preview.js'
import { Section } from '../../src/tui/components/common.js'
import { Dashboard } from '../../src/tui/components/dashboard.js'
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

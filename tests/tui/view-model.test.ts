import { describe, expect, it } from 'vitest'
import { createTaskDraft, getTaskDefinition } from '../../src/tui/tasks.js'
import { createInitialAppState, getVisibleWizardFields, isDraftValid, reduceAppState } from '../../src/tui/view-model.js'

describe('TUI view model', () => {
  it('defaults to the dashboard route', () => {
    expect(createInitialAppState().route).toBe('dashboard')
  })

  it('enters wizard when a task is selected', () => {
    const next = reduceAppState(createInitialAppState(), {
      type: 'task:selected',
      taskId: 'change-review',
    })

    expect(next.route).toBe('wizard')
    expect(next.activeTaskId).toBe('change-review')
  })

  it('enters run when preview execution starts', () => {
    const previewState = reduceAppState(createInitialAppState(), {
      type: 'preview:opened',
      command: {
        argv: ['review', '--local'],
        display: 'magpie review --local',
        summary: 'Review local changes',
      },
    })

    const running = reduceAppState(previewState, { type: 'execution:started' })

    expect(running.route).toBe('run')
    expect(running.run?.status).toBe('running')
  })

  it('returns to the dashboard when leaving a completed run', () => {
    const previewState = reduceAppState(createInitialAppState(), {
      type: 'preview:opened',
      command: {
        argv: ['review', '--local'],
        display: 'magpie review --local',
        summary: 'Review local changes',
      },
    })
    const running = reduceAppState(previewState, { type: 'execution:started' })
    const completed = reduceAppState(running, {
      type: 'execution:updated',
      run: {
        ...running.run!,
        status: 'completed',
        exitCode: 0,
      },
    })
    const reset = reduceAppState(completed, { type: 'run:closed' })

    expect(reset.route).toBe('dashboard')
    expect(reset.run).toBeUndefined()
  })

  it('reveals branch-only fields when branch review is selected', () => {
    const task = getTaskDefinition('change-review')

    expect(getVisibleWizardFields(task, { mode: 'local' }).map((field) => field.id)).not.toContain('branchBase')
    expect(getVisibleWizardFields(task, { mode: 'branch' }).map((field) => field.id)).toContain('branchBase')
  })

  it('stores preview commands and dashboard data', () => {
    const previewState = reduceAppState(createInitialAppState(), {
      type: 'wizard:submitted',
      command: {
        argv: ['review', '--local'],
        display: 'magpie review --local',
        summary: 'Review local changes',
      },
    })
    const hydrated = reduceAppState(previewState, {
      type: 'dashboard:data-loaded',
      sessions: {
        continue: [],
        recent: [],
      },
      health: {
        items: [
          {
            key: 'providers',
            label: 'Providers',
            status: 'unknown',
            detail: 'Not checked',
          },
        ],
      },
    })

    expect(previewState.route).toBe('preview')
    expect(hydrated.health?.items[0]?.key).toBe('providers')
  })

  it('validates required visible fields', () => {
    const invalidDraft = createTaskDraft('issue-fix')
    const validDraft = {
      ...invalidDraft,
      values: {
        ...invalidDraft.values,
        issue: 'Fix dashboard crash',
      },
    }

    expect(isDraftValid(invalidDraft)).toBe(false)
    expect(isDraftValid(validDraft)).toBe(true)
  })

  it('rejects files mode draft when files field is empty', () => {
    const draft = createTaskDraft('change-review')
    draft.values.mode = 'files'
    draft.values.files = ''

    expect(isDraftValid(draft)).toBe(false)

    draft.values.files = 'src/a.ts'
    expect(isDraftValid(draft)).toBe(true)
  })
})

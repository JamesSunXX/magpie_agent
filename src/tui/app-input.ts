import { buildCommandFromDraft, buildResumeCommand } from './command-builder.js'
import { TASKS } from './tasks.js'
import type { AppState, SessionCard, TaskDraft, TaskField, TaskValue, TaskValues } from './types.js'
import { isDraftValid, reduceAppState } from './view-model.js'

export interface InputKey {
  ctrl?: boolean
  return?: boolean
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  escape?: boolean
  backspace?: boolean
  delete?: boolean
}

type StateUpdater = (updater: (current: AppState) => AppState) => void

interface DashboardEntryTask {
  kind: 'task'
  taskId: TaskDraft['taskId']
}

interface DashboardEntrySession {
  kind: 'session'
  card: SessionCard
}

type DashboardEntry = DashboardEntryTask | DashboardEntrySession

function cycleSelect(options: Array<{ value: string }>, current: TaskValue, direction: 1 | -1): string {
  if (options.length === 0) {
    return ''
  }

  const currentIndex = options.findIndex((option) => option.value === current)
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + options.length) % options.length

  return options[nextIndex].value
}

export function getDashboardEntries(state: AppState): DashboardEntry[] {
  return [
    ...TASKS.map((task) => ({ kind: 'task' as const, taskId: task.id })),
    ...state.sessions.continue.map((card) => ({ kind: 'session' as const, card })),
    ...state.sessions.recent.map((card) => ({ kind: 'session' as const, card })),
  ]
}

export function moveSelection(state: AppState, delta: number, itemCount: number): AppState {
  if (itemCount === 0) {
    return state
  }

  return {
    ...state,
    selectedIndex: (state.selectedIndex + delta + itemCount) % itemCount,
  }
}

function updateDraftValues(draft: TaskDraft, nextValues: TaskValues): TaskDraft {
  return {
    ...draft,
    values: {
      ...draft.values,
      ...nextValues,
    },
  }
}

function resetToDashboard(state: AppState): AppState {
  return {
    ...state,
    route: 'dashboard',
    activeTaskId: undefined,
    draft: undefined,
    selectedIndex: 0,
  }
}

export function handleDashboardInput(params: {
  input: string
  key: InputKey
  state: AppState
  refreshDashboard: () => Promise<void>
  setState: StateUpdater
}): boolean {
  const { input, key, refreshDashboard, setState, state } = params
  const entries = getDashboardEntries(state)

  if (key.upArrow) {
    setState((current) => moveSelection(current, -1, entries.length))
    return true
  }

  if (key.downArrow) {
    setState((current) => moveSelection(current, 1, entries.length))
    return true
  }

  if (input === 'r') {
    void refreshDashboard()
    return true
  }

  if (!key.return) {
    return false
  }

  const selected = entries[state.selectedIndex]
  if (!selected) {
    return true
  }

  if (selected.kind === 'task') {
    setState((current) => reduceAppState(current, {
      type: 'task:selected',
      taskId: selected.taskId,
    }))
    return true
  }

  const command = buildResumeCommand(selected.card)
  if (command) {
    setState((current) => reduceAppState(current, {
      type: 'preview:opened',
      command,
    }))
  }
  return true
}

export function handleWizardInput(params: {
  input: string
  key: InputKey
  state: AppState
  visibleFields: TaskField[]
  setState: StateUpdater
}): boolean {
  const { input, key, setState, state, visibleFields } = params
  const draft = state.draft
  if (!draft) {
    return false
  }

  if (key.escape) {
    setState((current) => resetToDashboard(current))
    return true
  }

  if (key.upArrow) {
    setState((current) => moveSelection(current, -1, visibleFields.length))
    return true
  }

  if (key.downArrow) {
    setState((current) => moveSelection(current, 1, visibleFields.length))
    return true
  }

  if (input === 'a') {
    setState((current) => current.draft
      ? {
          ...current,
          draft: {
            ...current.draft,
            showAdvanced: !current.draft.showAdvanced,
          },
          selectedIndex: 0,
        }
      : current)
    return true
  }

  const field = visibleFields[state.selectedIndex]
  if (!field) {
    return true
  }

  if (field.type === 'toggle' && input === ' ') {
    setState((current) => current.draft
      ? {
          ...current,
          draft: updateDraftValues(current.draft, {
            [field.id]: !current.draft.values[field.id],
          }),
        }
      : current)
    return true
  }

  if (field.type === 'select' && field.options) {
    if (key.leftArrow || input === 'h') {
      setState((current) => current.draft
        ? {
            ...current,
            draft: updateDraftValues(current.draft, {
              [field.id]: cycleSelect(field.options || [], current.draft.values[field.id], -1),
            }),
          }
        : current)
      return true
    }

    if (key.rightArrow || input === 'l' || input === ' ') {
      setState((current) => current.draft
        ? {
            ...current,
            draft: updateDraftValues(current.draft, {
              [field.id]: cycleSelect(field.options || [], current.draft.values[field.id], 1),
            }),
          }
        : current)
      return true
    }
  }

  if (field.type === 'text') {
    if (key.backspace || key.delete) {
      setState((current) => current.draft
        ? {
            ...current,
            draft: updateDraftValues(current.draft, {
              [field.id]: String(current.draft.values[field.id] || '').slice(0, -1),
            }),
          }
        : current)
      return true
    }

    if (input && !key.return) {
      setState((current) => current.draft
        ? {
            ...current,
            draft: updateDraftValues(current.draft, {
              [field.id]: `${String(current.draft.values[field.id] || '')}${input}`,
            }),
          }
        : current)
      return true
    }
  }

  if (key.return && isDraftValid(draft)) {
    setState((current) => current.draft
      ? reduceAppState(current, {
          type: 'wizard:submitted',
          command: buildCommandFromDraft(current.draft),
        })
      : current)
    return true
  }

  return false
}

export function handlePreviewInput(params: {
  key: InputKey
  state: AppState
  setState: StateUpdater
  startRun: () => void
}): boolean {
  const { key, setState, startRun, state } = params

  if (key.escape) {
    setState((current) => ({
      ...current,
      route: current.draft ? 'wizard' : 'dashboard',
      selectedIndex: 0,
    }))
    return true
  }

  if (key.return && state.command) {
    startRun()
    return true
  }

  return false
}

export function handleRunInput(params: {
  key: InputKey
  state: AppState
  setState: StateUpdater
}): boolean {
  const { key, setState, state } = params

  if (!key.escape || state.run?.status === 'running') {
    return false
  }

  setState((current) => reduceAppState(current, {
    type: 'run:closed',
  }))
  return true
}

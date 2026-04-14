import { buildCommandDisplay, buildCommandFromDraft, buildResumeCommand } from './command-builder.js'
import { TASKS } from './tasks.js'
import type { AppState, BuiltCommand, GraphWorkbenchAction, SessionCard, TaskDraft, TaskField, TaskValue, TaskValues } from './types.js'
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
    graphWorkbench: undefined,
    selectedIndex: 0,
  }
}

function cycleWorkbenchPanel(
  current: NonNullable<AppState['graphWorkbench']>['focusedPanel'],
  direction: 1 | -1
): NonNullable<AppState['graphWorkbench']>['focusedPanel'] {
  const panels: Array<NonNullable<AppState['graphWorkbench']>['focusedPanel']> = ['overview', 'actions', 'events']
  const currentIndex = panels.indexOf(current)
  return panels[(currentIndex + direction + panels.length) % panels.length] || 'overview'
}

function cycleWorkbenchNode(state: AppState, direction: 1 | -1): AppState {
  const workbench = state.graphWorkbench
  const nodes = workbench?.data?.nodes || []
  if (!workbench || nodes.length === 0) {
    return state
  }

  const currentIndex = Math.max(0, nodes.findIndex((node) => node.id === workbench.selectedNodeId))
  const nextIndex = (currentIndex + direction + nodes.length) % nodes.length

  return {
    ...state,
    graphWorkbench: {
      ...workbench,
      selectedNodeId: nodes[nextIndex]?.id,
      selectedActionIndex: 0,
      pendingConfirmationActionId: undefined,
    },
  }
}

function cycleWorkbenchAction(state: AppState, direction: 1 | -1): AppState {
  const workbench = state.graphWorkbench
  const actionCount = workbench?.data?.actions.length || 0
  if (!workbench || actionCount === 0) {
    return state
  }

  return {
    ...state,
    graphWorkbench: {
      ...workbench,
      selectedActionIndex: (workbench.selectedActionIndex + direction + actionCount) % actionCount,
      pendingConfirmationActionId: undefined,
    },
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

  if (selected.card.capability === 'harness' && selected.card.graphPath) {
    setState((current) => reduceAppState(current, {
      type: 'graph:opened',
      sessionId: selected.card.id,
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

export function handleGraphWorkbenchInput(params: {
  input: string
  key: InputKey
  state: AppState
  refreshWorkbench: () => Promise<void>
  openCommandPreview: (command: BuiltCommand) => void
  runWorkbenchAction: (action: GraphWorkbenchAction) => void
  setState: StateUpdater
}): boolean {
  const { input, key, refreshWorkbench, setState, state } = params
  const workbench = state.graphWorkbench

  if (!workbench) {
    return false
  }

  if (key.escape) {
    setState((current) => resetToDashboard(current))
    return true
  }

  if (input === 'r') {
    void refreshWorkbench()
    return true
  }

  if (key.leftArrow) {
    setState((current) => current.graphWorkbench
      ? {
          ...current,
          graphWorkbench: {
            ...current.graphWorkbench,
            focusedPanel: cycleWorkbenchPanel(current.graphWorkbench.focusedPanel, -1),
            pendingConfirmationActionId: undefined,
          },
        }
      : current)
    return true
  }

  if (key.rightArrow) {
    setState((current) => current.graphWorkbench
      ? {
          ...current,
          graphWorkbench: {
            ...current.graphWorkbench,
            focusedPanel: cycleWorkbenchPanel(current.graphWorkbench.focusedPanel, 1),
            pendingConfirmationActionId: undefined,
          },
        }
      : current)
    return true
  }

  if (key.upArrow) {
    setState((current) => current.graphWorkbench?.focusedPanel === 'actions'
      ? cycleWorkbenchAction(current, -1)
      : current.graphWorkbench?.focusedPanel === 'overview'
        ? cycleWorkbenchNode(current, -1)
        : current)
    return true
  }

  if (key.downArrow) {
    setState((current) => current.graphWorkbench?.focusedPanel === 'actions'
      ? cycleWorkbenchAction(current, 1)
      : current.graphWorkbench?.focusedPanel === 'overview'
        ? cycleWorkbenchNode(current, 1)
        : current)
    return true
  }

  if (key.return && workbench.focusedPanel === 'actions') {
    const action = workbench.data?.actions[workbench.selectedActionIndex]
    if (!action) {
      return true
    }

    if (action.kind === 'jump') {
      params.openCommandPreview({
        argv: [...action.command],
        display: buildCommandDisplay(action.command),
        summary: action.description,
      })
      return true
    }

    if (action.requiresConfirmation && workbench.pendingConfirmationActionId !== action.id) {
      setState((current) => current.graphWorkbench
        ? {
            ...current,
            graphWorkbench: {
              ...current.graphWorkbench,
              pendingConfirmationActionId: action.id,
              message: `Press Enter again to confirm ${action.label.toLowerCase()}.`,
            },
          }
        : current)
      return true
    }

    params.runWorkbenchAction(action)
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
      route: current.graphWorkbench ? 'graph-workbench' : current.draft ? 'wizard' : 'dashboard',
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

  if (state.graphWorkbench) {
    setState((current) => ({
      ...current,
      route: 'graph-workbench',
      selectedIndex: 0,
    }))
    return true
  }

  setState((current) => reduceAppState(current, {
    type: 'run:closed',
  }))
  return true
}

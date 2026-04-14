import { createTaskDraft, getTaskDefinition } from './tasks.js'
import type { AppAction, AppState, RunState, TaskDefinition, TaskDraft, TaskField, TaskValues } from './types.js'

function createRunState(command: AppState['command']): RunState | undefined {
  if (!command) {
    return undefined
  }

  return {
    command,
    display: command.display,
    logs: [],
    artifacts: {},
    status: 'running',
  }
}

export function createInitialAppState(): AppState {
  return {
    route: 'dashboard',
    selectedIndex: 0,
    sessions: {
      continue: [],
      recent: [],
    },
  }
}

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'task:selected':
      return {
        ...state,
        route: 'wizard',
        activeTaskId: action.taskId,
        selectedIndex: 0,
        draft: createTaskDraft(action.taskId),
        command: undefined,
        run: undefined,
      }
    case 'graph:opened':
      return {
        ...state,
        route: 'graph-workbench',
        selectedIndex: 0,
        command: undefined,
        run: undefined,
        graphWorkbench: {
          sessionId: action.sessionId,
          ...(action.selectedNodeId ? { selectedNodeId: action.selectedNodeId } : {}),
          focusedPanel: 'overview',
          selectedActionIndex: 0,
        },
      }
    case 'preview:opened':
      return {
        ...state,
        route: 'preview',
        selectedIndex: 0,
        command: action.command,
      }
    case 'wizard:submitted':
      return {
        ...state,
        route: 'preview',
        selectedIndex: 0,
        command: action.command,
      }
    case 'execution:started':
      return {
        ...state,
        route: 'run',
        selectedIndex: 0,
        run: createRunState(state.command),
      }
    case 'execution:updated':
      return {
        ...state,
        run: action.run,
      }
    case 'run:closed':
      return {
        ...createInitialAppState(),
        sessions: state.sessions,
        health: state.health,
      }
    case 'dashboard:data-loaded':
      return {
        ...state,
        sessions: action.sessions,
        health: action.health,
      }
    default:
      return state
  }
}

export function getVisibleWizardFields(
  taskOrDraft: TaskDefinition | TaskDraft,
  valuesOverride?: TaskValues
): TaskField[] {
  const task = 'fields' in taskOrDraft ? taskOrDraft : getTaskDefinition(taskOrDraft.taskId)
  const values = valuesOverride || ('values' in taskOrDraft ? taskOrDraft.values : task.defaults)
  const showAdvanced = 'showAdvanced' in taskOrDraft ? taskOrDraft.showAdvanced : true

  return task.fields.filter((field) => {
    if (field.advanced && !showAdvanced) {
      return false
    }

    return field.visibleWhen ? field.visibleWhen(values) : true
  })
}

export function isDraftValid(draft: TaskDraft): boolean {
  return getVisibleWizardFields(draft).every((field) => {
    if (!field.required) {
      return true
    }

    const value = draft.values[field.id]
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
  })
}

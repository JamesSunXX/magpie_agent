import React, { useEffect, useState } from 'react'
import { useApp, useInput } from 'ink'
import { buildCommandFromDraft, buildResumeCommand } from './command-builder.js'
import { Dashboard } from './components/dashboard.js'
import { CommandPreview } from './components/command-preview.js'
import { RunView } from './components/run-view.js'
import { TaskWizard } from './components/task-wizard.js'
import { inspectEnvironmentHealth } from './environment-health.js'
import { createRunController } from './run-controller.js'
import { loadSessionDashboard } from './session-dashboard.js'
import { TASKS, getTaskDefinition } from './tasks.js'
import type { AppState, SessionCard, TaskDraft } from './types.js'
import { createInitialAppState, getVisibleWizardFields, isDraftValid, reduceAppState } from './view-model.js'

export interface AppProps {
  cwd: string
  configPath?: string
}

function cycleSelect(
  options: Array<{ value: string }>,
  current: string | boolean | undefined,
  direction: 1 | -1
): string {
  if (options.length === 0) {
    return ''
  }

  const currentIndex = options.findIndex((option) => option.value === current)
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + options.length) % options.length

  return options[nextIndex].value
}

function getDashboardEntries(
  state: AppState
): Array<{ kind: 'task'; taskId: TaskDraft['taskId'] } | { kind: 'session'; card: SessionCard }> {
  return [
    ...TASKS.map((task) => ({ kind: 'task' as const, taskId: task.id })),
    ...state.sessions.continue.map((card) => ({ kind: 'session' as const, card })),
    ...state.sessions.recent.map((card) => ({ kind: 'session' as const, card })),
  ]
}

function moveSelection(state: AppState, delta: number, itemCount: number): AppState {
  if (itemCount === 0) {
    return state
  }

  return {
    ...state,
    selectedIndex: (state.selectedIndex + delta + itemCount) % itemCount,
  }
}

export function App(props: AppProps) {
  const { exit } = useApp()
  const [state, setState] = useState<AppState>(createInitialAppState())
  const visibleFields = state.draft ? getVisibleWizardFields(state.draft) : []

  useEffect(() => {
    let cancelled = false

    async function loadDashboard(): Promise<void> {
      const [sessions, health] = await Promise.all([
        loadSessionDashboard({ cwd: props.cwd }),
        inspectEnvironmentHealth({ cwd: props.cwd, configPath: props.configPath }),
      ])

      if (!cancelled) {
        setState((current) => reduceAppState(current, {
          type: 'dashboard:data-loaded',
          sessions,
          health,
        }))
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [props.configPath, props.cwd])

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit()
      return
    }

    if (input === 'q') {
      if (state.route === 'run' && state.run?.status === 'running') {
        return
      }

      exit()
      return
    }

    if (state.route === 'dashboard') {
      const entries = getDashboardEntries(state)

      if (key.upArrow) {
        setState((current) => moveSelection(current, -1, entries.length))
        return
      }

      if (key.downArrow) {
        setState((current) => moveSelection(current, 1, entries.length))
        return
      }

      if (input === 'r') {
        void Promise.all([
          loadSessionDashboard({ cwd: props.cwd }),
          inspectEnvironmentHealth({ cwd: props.cwd, configPath: props.configPath }),
        ]).then(([sessions, health]) => {
          setState((current) => reduceAppState(current, {
            type: 'dashboard:data-loaded',
            sessions,
            health,
          }))
        })
        return
      }

      if (key.return) {
        const selected = entries[state.selectedIndex]
        if (!selected) {
          return
        }

        if (selected.kind === 'task') {
          setState((current) => reduceAppState(current, {
            type: 'task:selected',
            taskId: selected.taskId,
          }))
          return
        }

        const command = buildResumeCommand(selected.card)
        if (command) {
          setState((current) => reduceAppState(current, {
            type: 'preview:opened',
            command,
          }))
        }
      }

      return
    }

    if (state.route === 'wizard' && state.draft) {
      if (key.escape) {
        setState((current) => ({
          ...current,
          route: 'dashboard',
          activeTaskId: undefined,
          draft: undefined,
          selectedIndex: 0,
        }))
        return
      }

      if (key.upArrow) {
        setState((current) => moveSelection(current, -1, visibleFields.length))
        return
      }

      if (key.downArrow) {
        setState((current) => moveSelection(current, 1, visibleFields.length))
        return
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
        return
      }

      const field = visibleFields[state.selectedIndex]
      if (!field) {
        return
      }

      if (field.type === 'toggle' && input === ' ') {
        setState((current) => current.draft
          ? {
              ...current,
              draft: {
                ...current.draft,
                values: {
                  ...current.draft.values,
                  [field.id]: !current.draft.values[field.id],
                },
              },
            }
          : current)
        return
      }

      if (field.type === 'select' && field.options) {
        if (key.leftArrow || input === 'h') {
          setState((current) => current.draft
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  values: {
                    ...current.draft.values,
                    [field.id]: cycleSelect(field.options || [], current.draft.values[field.id], -1),
                  },
                },
              }
            : current)
          return
        }

        if (key.rightArrow || input === 'l' || input === ' ') {
          setState((current) => current.draft
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  values: {
                    ...current.draft.values,
                    [field.id]: cycleSelect(field.options || [], current.draft.values[field.id], 1),
                  },
                },
              }
            : current)
          return
        }
      }

      if (field.type === 'text') {
        if (key.backspace || key.delete) {
          setState((current) => current.draft
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  values: {
                    ...current.draft.values,
                    [field.id]: String(current.draft.values[field.id] || '').slice(0, -1),
                  },
                },
              }
            : current)
          return
        }

        if (!key.return && input && !key.tab && !key.escape && !key.leftArrow && !key.rightArrow) {
          setState((current) => current.draft
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  values: {
                    ...current.draft.values,
                    [field.id]: `${String(current.draft.values[field.id] || '')}${input}`,
                  },
                },
              }
            : current)
          return
        }
      }

      if (key.return && isDraftValid(state.draft)) {
        setState((current) => reduceAppState(current, {
          type: 'wizard:submitted',
          command: buildCommandFromDraft(state.draft!),
        }))
      }

      return
    }

    if (state.route === 'preview' && state.command) {
      if (key.escape) {
        setState((current) => ({
          ...current,
          route: current.draft ? 'wizard' : 'dashboard',
        }))
        return
      }

      if (key.return) {
        setState((current) => reduceAppState(current, { type: 'execution:started' }))

        createRunController().run(
          state.command,
          {
            cwd: props.cwd,
            cliArgv0: process.argv[1],
            configPath: props.configPath,
          },
          {
            onUpdate: (run) => {
              setState((current) => reduceAppState(current, {
                type: 'execution:updated',
                run,
              }))
            },
          }
        )
      }

      return
    }

    if (state.route === 'run' && key.escape && state.run?.status !== 'running') {
      setState((current) => reduceAppState(current, { type: 'run:closed' }))
    }
  })

  if (state.route === 'dashboard') {
    return <Dashboard selectedIndex={state.selectedIndex} sessions={state.sessions} health={state.health} />
  }

  if (state.route === 'wizard' && state.draft) {
    return (
      <TaskWizard
        task={getTaskDefinition(state.draft.taskId)}
        draft={state.draft}
        fields={visibleFields}
        selectedIndex={Math.min(state.selectedIndex, Math.max(visibleFields.length - 1, 0))}
        canSubmit={isDraftValid(state.draft)}
      />
    )
  }

  if (state.route === 'preview' && state.command) {
    return <CommandPreview command={state.command} />
  }

  return state.run ? <RunView run={state.run} /> : null
}

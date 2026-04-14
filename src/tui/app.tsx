import React, { useEffect, useState } from 'react'
import { Text, useApp, useInput } from 'ink'
import { Dashboard } from './components/dashboard.js'
import { GraphWorkbench } from './components/graph-workbench.js'
import { CommandPreview } from './components/command-preview.js'
import { RunView } from './components/run-view.js'
import { TaskWizard } from './components/task-wizard.js'
import { handleDashboardInput, handleGraphWorkbenchInput, handlePreviewInput, handleRunInput, handleWizardInput } from './app-input.js'
import { refreshDashboardData } from './dashboard-loader.js'
import { loadGraphWorkbench } from './graph-workbench-loader.js'
import { createRunController } from './run-controller.js'
import { buildCommandDisplay } from './command-builder.js'
import { getTaskDefinition } from './tasks.js'
import type { AppState, BuiltCommand, GraphWorkbenchAction } from './types.js'
import { createInitialAppState, getVisibleWizardFields, isDraftValid, reduceAppState } from './view-model.js'

export interface AppProps {
  cwd: string
  configPath?: string
}

export function App(props: AppProps) {
  const { exit } = useApp()
  const [state, setState] = useState<AppState>(createInitialAppState())
  const visibleFields = state.draft ? getVisibleWizardFields(state.draft) : []

  async function refreshDashboard(): Promise<void> {
    const { sessions, health } = await refreshDashboardData({
      cwd: props.cwd,
      configPath: props.configPath,
    })

    setState((current) => reduceAppState(current, {
      type: 'dashboard:data-loaded',
      sessions,
      health,
    }))
  }

  async function refreshWorkbench(): Promise<void> {
    const workbench = state.graphWorkbench
    if (!workbench) {
      return
    }

    const data = await loadGraphWorkbench({
      cwd: props.cwd,
      sessionId: workbench.sessionId,
      selectedNodeId: workbench.selectedNodeId,
    })

    setState((current) => {
      const currentWorkbench = current.graphWorkbench
      if (!currentWorkbench || currentWorkbench.sessionId !== workbench.sessionId) {
        return current
      }

      return {
        ...current,
        graphWorkbench: {
          ...currentWorkbench,
          data,
          selectedNodeId: data.selectedNodeId || currentWorkbench.selectedNodeId,
          selectedActionIndex: Math.min(
            currentWorkbench.selectedActionIndex,
            Math.max(data.actions.length - 1, 0)
          ),
        },
      }
    })
  }

  function openWorkbenchCommandPreview(command: BuiltCommand | undefined): void {
    if (!command) {
      return
    }

    setState((current) => reduceAppState(current, {
      type: 'preview:opened',
      command,
    }))
  }

  function runWorkbenchAction(action: GraphWorkbenchAction): void {
    const command: BuiltCommand = {
      argv: [...action.command],
      display: buildCommandDisplay(action.command),
      summary: action.description,
    }

    setState((current) => current.graphWorkbench
      ? {
          ...current,
          graphWorkbench: {
            ...current.graphWorkbench,
            pendingConfirmationActionId: undefined,
            message: `Running ${action.label}...`,
          },
        }
      : current)

    void createRunController().run(
      command,
      {
        cwd: props.cwd,
        cliArgv0: process.argv[1],
        configPath: props.configPath,
      },
      {
        onUpdate: (run) => {
          if (run.status === 'completed') {
            setState((current) => current.graphWorkbench
              ? {
                  ...current,
                  graphWorkbench: {
                    ...current.graphWorkbench,
                    message: `${action.label} completed.`,
                  },
                }
              : current)
            void refreshWorkbench()
            return
          }

          if (run.status === 'failed') {
            setState((current) => current.graphWorkbench
              ? {
                  ...current,
                  graphWorkbench: {
                    ...current.graphWorkbench,
                    message: `${action.label} failed.`,
                  },
                }
              : current)
          }
        },
        onError: () => {
          setState((current) => current.graphWorkbench
            ? {
                ...current,
                graphWorkbench: {
                  ...current.graphWorkbench,
                  message: `${action.label} failed.`,
                },
              }
            : current)
        },
      }
    )
  }

  function startRun(): void {
    if (!state.command) {
      return
    }

    setState((current) => reduceAppState(current, { type: 'execution:started' }))

    void createRunController().run(
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

  useEffect(() => {
    let cancelled = false

    void refreshDashboardData({
      cwd: props.cwd,
      configPath: props.configPath,
    }).then(({ sessions, health }) => {
      if (cancelled) {
        return
      }

      setState((current) => reduceAppState(current, {
        type: 'dashboard:data-loaded',
        sessions,
        health,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [props.configPath, props.cwd])

  useEffect(() => {
    if (state.route !== 'graph-workbench' || !state.graphWorkbench?.sessionId) {
      return
    }

    let cancelled = false

    void loadGraphWorkbench({
      cwd: props.cwd,
      sessionId: state.graphWorkbench.sessionId,
      selectedNodeId: state.graphWorkbench.selectedNodeId,
    }).then((data) => {
      if (cancelled) {
        return
      }

      setState((current) => {
        const currentWorkbench = current.graphWorkbench
        if (!currentWorkbench || currentWorkbench.sessionId !== state.graphWorkbench?.sessionId) {
          return current
        }

        return {
          ...current,
          graphWorkbench: {
            ...currentWorkbench,
            data,
            selectedNodeId: data.selectedNodeId || currentWorkbench.selectedNodeId,
            selectedActionIndex: Math.min(
              currentWorkbench.selectedActionIndex,
              Math.max(data.actions.length - 1, 0)
            ),
          },
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [props.cwd, state.graphWorkbench?.selectedNodeId, state.graphWorkbench?.sessionId, state.route])

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
      handleDashboardInput({
        input,
        key,
        state,
        refreshDashboard,
        setState,
      })
      return
    }

    if (state.route === 'wizard') {
      handleWizardInput({
        input,
        key,
        state,
        visibleFields,
        setState,
      })
      return
    }

    if (state.route === 'graph-workbench') {
      handleGraphWorkbenchInput({
        input,
        key,
        state,
        refreshWorkbench,
        openCommandPreview: openWorkbenchCommandPreview,
        runWorkbenchAction,
        setState,
      })
      return
    }

    if (state.route === 'preview') {
      handlePreviewInput({
        key,
        state,
        setState,
        startRun,
      })
      return
    }

    handleRunInput({
      key,
      state,
      setState,
    })
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

  if (state.route === 'graph-workbench' && state.graphWorkbench?.data) {
    return (
      <GraphWorkbench
        workbench={state.graphWorkbench.data}
        focusedPanel={state.graphWorkbench.focusedPanel}
        selectedActionIndex={state.graphWorkbench.selectedActionIndex}
        message={state.graphWorkbench.message}
      />
    )
  }

  if (state.route === 'graph-workbench') {
    return <Text color="gray">Loading graph workbench...</Text>
  }

  return state.run ? <RunView run={state.run} /> : null
}

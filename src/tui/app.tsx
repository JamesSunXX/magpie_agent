import React, { useEffect, useState } from 'react'
import { useApp, useInput } from 'ink'
import { Dashboard } from './components/dashboard.js'
import { CommandPreview } from './components/command-preview.js'
import { RunView } from './components/run-view.js'
import { TaskWizard } from './components/task-wizard.js'
import { handleDashboardInput, handlePreviewInput, handleRunInput, handleWizardInput } from './app-input.js'
import { refreshDashboardData } from './dashboard-loader.js'
import { createRunController } from './run-controller.js'
import { getTaskDefinition } from './tasks.js'
import type { AppState } from './types.js'
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

  return state.run ? <RunView run={state.run} /> : null
}

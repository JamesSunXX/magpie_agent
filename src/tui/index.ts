import React from 'react'
import { render } from 'ink'
import { App, type AppProps } from './app.js'

export async function startTuiApp(props: AppProps) {
  return render(React.createElement(App, props))
}

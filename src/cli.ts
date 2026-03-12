#!/usr/bin/env node
import { createProgram } from './cli/program.js'

const brokenPipeHandlerInstalled = Symbol.for('magpie.broken-pipe-handler-installed')

function installBrokenPipeHandler(stream: NodeJS.WriteStream): void {
  const trackedStream = stream as NodeJS.WriteStream & {
    [brokenPipeHandlerInstalled]?: boolean
  }

  if (trackedStream[brokenPipeHandlerInstalled]) {
    return
  }

  trackedStream[brokenPipeHandlerInstalled] = true
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      process.exit(0)
    }

    throw error
  })
}

installBrokenPipeHandler(process.stdout)
installBrokenPipeHandler(process.stderr)

createProgram().parse()

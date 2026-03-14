export class CommandExitError extends Error {
  readonly code: number

  constructor(code: number) {
    super(`Command requested exit with code ${code}`)
    this.code = code
  }
}

export function commandExit(code: number): never {
  throw new CommandExitError(code)
}

export async function runInCommandContext<T>(cwd: string | undefined, fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd()

  if (cwd && cwd !== originalCwd) {
    process.chdir(cwd)
  }

  try {
    return await fn()
  } finally {
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd)
    }
  }
}

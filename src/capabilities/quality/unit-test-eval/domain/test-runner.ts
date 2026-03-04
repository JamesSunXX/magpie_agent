import { execSync } from 'child_process'
import type { TestRunResult } from '../types.js'

export function runTestCommand(cwd: string, command: string): TestRunResult {
  try {
    const output = execSync(command, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    })

    return {
      command,
      passed: true,
      output,
      exitCode: 0,
    }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string; message?: string }
    return {
      command,
      passed: false,
      output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim(),
      exitCode: e.status ?? 1,
    }
  }
}

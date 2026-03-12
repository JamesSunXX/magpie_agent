import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { CapabilityContext } from './context.js'

export interface CapabilitySubprocessResult {
  exitCode: number
  stdout: string
  stderr: string
}

function repoRoot(): string {
  const filePath = fileURLToPath(import.meta.url)
  return resolve(dirname(filePath), '../../../')
}

function resolveCliCommand(): { file: string; args: string[] } {
  const root = repoRoot()
  const distCli = join(root, 'dist', 'cli.js')
  if (existsSync(distCli)) {
    return {
      file: process.execPath,
      args: [distCli],
    }
  }

  const tsxBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
  return {
    file: tsxBin,
    args: [join(root, 'src', 'cli.ts')],
  }
}

export async function runCapabilitySubprocess(
  commandName: string,
  args: string[],
  ctx: CapabilityContext
): Promise<CapabilitySubprocessResult> {
  const cli = resolveCliCommand()

  return new Promise((resolvePromise, reject) => {
    const child = spawn(cli.file, [...cli.args, commandName, ...args], {
      cwd: ctx.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

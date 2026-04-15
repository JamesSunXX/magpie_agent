import { existsSync } from 'fs'

export interface DiagnosticCheckResult {
  id: string
  passed: boolean
  message: string
  path?: string
}

export interface FailureDiagnosticsResult {
  checks: DiagnosticCheckResult[]
  hasBlockingIssues: boolean
}

interface FailureDiagnosticsInput {
  configPath?: string
  metadataPath?: string
  requiredPaths?: string[]
}

function checkPath(id: string, targetPath: string | undefined, missingMessage: string): DiagnosticCheckResult {
  if (!targetPath) {
    return {
      id,
      passed: false,
      message: missingMessage,
    }
  }

  return {
    id,
    passed: existsSync(targetPath),
    message: existsSync(targetPath) ? `${id} ok` : missingMessage,
    path: targetPath,
  }
}

export async function runFailureDiagnostics(input: FailureDiagnosticsInput): Promise<FailureDiagnosticsResult> {
  const checks: DiagnosticCheckResult[] = []

  checks.push(checkPath('config_exists', input.configPath, 'Config path is missing or no longer exists.'))
  checks.push(checkPath('input_metadata_exists', input.metadataPath, 'Session input metadata is missing.'))

  const requiredPathChecks = (input.requiredPaths || []).map((targetPath, index) => ({
    id: `repo_paths_exist:${index + 1}`,
    passed: existsSync(targetPath),
    message: existsSync(targetPath) ? 'Repository path is available.' : `Required repository path is missing: ${targetPath}`,
    path: targetPath,
  }))
  checks.push(...requiredPathChecks)

  return {
    checks,
    hasBlockingIssues: checks.some((check) => !check.passed),
  }
}

import { existsSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { loadConfigV2 } from '../../../../platform/config/loader.js'
import { DEFAULT_UNIT_TEST_EVAL_CONFIG } from '../config.js'
import type { UnitTestEvalInput, UnitTestEvalPrepared } from '../types.js'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const TEST_FILE_PATTERN = /\.test\.(ts|tsx|js|jsx)$/
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist'])

function walkFiles(root: string, current: string, output: string[]): void {
  const entries = readdirSync(current)

  for (const entry of entries) {
    const fullPath = join(current, entry)
    const relPath = relative(root, fullPath)

    if (!relPath) continue

    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (IGNORED_DIRS.has(entry)) continue
      walkFiles(root, fullPath, output)
      continue
    }

    if (!stat.isFile()) continue
    output.push(relPath.replace(/\\/g, '/'))
  }
}

function collectSourceAndTests(cwd: string): { sourceFiles: string[]; testFiles: string[] } {
  const allFiles: string[] = []
  walkFiles(cwd, cwd, allFiles)

  const sourceFiles = allFiles.filter((file) => {
    const ext = file.slice(file.lastIndexOf('.'))
    return SOURCE_EXTENSIONS.has(ext) && file.startsWith('src/')
  })

  const testFiles = allFiles.filter((file) => TEST_FILE_PATTERN.test(file) || file.startsWith('tests/'))

  return {
    sourceFiles,
    testFiles,
  }
}

export async function prepareUnitTestEval(
  input: UnitTestEvalInput,
  ctx: CapabilityContext
): Promise<UnitTestEvalPrepared> {
  const cwd = resolve(input.path || ctx.cwd)
  if (!existsSync(cwd)) {
    throw new Error(`Path does not exist: ${cwd}`)
  }

  const config = loadConfigV2(ctx.configPath)
  const moduleConfig = config.capabilities.quality?.unitTestEval || DEFAULT_UNIT_TEST_EVAL_CONFIG

  const { sourceFiles, testFiles } = collectSourceAndTests(cwd)

  const maxFiles = input.maxFiles ?? moduleConfig.max_files ?? DEFAULT_UNIT_TEST_EVAL_CONFIG.max_files
  const minCoverage = input.minCoverage ?? moduleConfig.min_coverage ?? DEFAULT_UNIT_TEST_EVAL_CONFIG.min_coverage
  const format = input.format ?? moduleConfig.output_format ?? DEFAULT_UNIT_TEST_EVAL_CONFIG.output_format
  const runTests = input.runTests ?? false
  const testCommand = input.testCommand || 'npm run test:run'

  return {
    cwd,
    sourceFiles: sourceFiles.slice(0, maxFiles),
    testFiles,
    maxFiles,
    minCoverage,
    format,
    runTests,
    testCommand,
  }
}

#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = process.cwd()
const srcDir = path.join(root, 'src')
const routingCapabilityPath = 'src/capabilities/routing/index.ts'

function isCliAllowedTarget(target) {
  return (
    target.startsWith('src/cli/') ||
    target.startsWith('src/core/') ||
    target.startsWith('src/capabilities/') ||
    target.startsWith('src/platform/') ||
    target.startsWith('src/knowledge/') ||
    target.startsWith('src/memory/') ||
    target.startsWith('src/state/') ||
    target.startsWith('src/config/')
  )
}

const CAPABILITY_EXCEPTIONS = new Map([
  ['src/capabilities/loop/application/execute.ts', new Set([
    'src/capabilities/workflows/shared/runtime.ts',
  ])],
  ['src/capabilities/loop/domain/test-execution.ts', new Set([
    'src/capabilities/workflows/shared/runtime.ts',
  ])],
  ['src/capabilities/loop/domain/constraints.ts', new Set([
    'src/capabilities/trd/types.ts',
  ])],
  ['src/capabilities/workflows/harness/application/execute.ts', new Set([
    'src/capabilities/routing/index.ts',
    'src/capabilities/discuss/index.ts',
    'src/capabilities/loop/index.ts',
    'src/capabilities/loop/types.ts',
    'src/capabilities/quality/unit-test-eval/index.ts',
    'src/capabilities/review/index.ts',
  ])],
  ['src/capabilities/workflows/issue-fix/application/execute.ts', new Set([
    'src/capabilities/routing/index.ts',
  ])],
])

export function isExplicitCapabilityException(fromFile, target) {
  if (target === routingCapabilityPath) return true

  return CAPABILITY_EXCEPTIONS.get(fromFile)?.has(target) === true
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

function toPosix(p) {
  return p.replace(/\\/g, '/')
}

function resolveImport(file, spec) {
  if (!spec.startsWith('.')) return null
  const resolved = path.resolve(path.dirname(file), spec)
  return `${toPosix(path.relative(root, resolved))}.ts`.replace(/\.js\.ts$/, '.ts')
}

const files = walk(srcDir)
export function collectBoundaryViolations() {
  const violations = []

  for (const file of files) {
    const relFile = toPosix(path.relative(root, file))
    const content = fs.readFileSync(file, 'utf-8')

    const imports = [...content.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const spec of imports) {
      const target = resolveImport(file, spec)
      if (!target) continue

      if (relFile.startsWith('src/core/') && target.startsWith('src/capabilities/')) {
        violations.push(`${relFile} must not depend on capabilities (${target})`)
      }

      if (relFile.startsWith('src/platform/') && target.startsWith('src/capabilities/')) {
        violations.push(`${relFile} must not depend on capabilities (${target})`)
      }

      if (relFile.startsWith('src/shared/') && target.startsWith('src/capabilities/')) {
        violations.push(`${relFile} must not depend on capabilities (${target})`)
      }

      if (relFile.startsWith('src/capabilities/') && relFile !== 'src/capabilities/index.ts') {
        if (target.startsWith('src/commands/')) {
          violations.push(`${relFile} must not depend on commands (${target})`)
        }

        const fromCap = relFile.split('/')[2]
        if (target.startsWith('src/capabilities/')) {
          const toCap = target.split('/')[2]
          if (fromCap && toCap && fromCap !== toCap) {
            if (!isExplicitCapabilityException(relFile, target)) {
              violations.push(`${relFile} must not depend on another capability (${target})`)
            }
          }
        }
      }

      if (relFile.startsWith('src/cli/')) {
        if (!isCliAllowedTarget(target)) {
          violations.push(`${relFile} has disallowed dependency (${target})`)
        }
      }
    }
  }

  return violations
}

export function runBoundaryCheck({
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const violations = collectBoundaryViolations()

  if (violations.length > 0) {
    stderr('Boundary check failed:')
    for (const violation of violations) {
      stderr(`- ${violation}`)
    }
    return { valid: false, violations }
  }

  stdout('Boundary check passed.')
  return { valid: true, violations: [] }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const result = runBoundaryCheck()
  if (!result.valid) {
    process.exit(1)
  }
}

#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const srcDir = path.join(root, 'src')

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
const violations = []

const legacyCliBridgeAllowList = new Set([
  'src/cli/commands/review.ts',
  'src/cli/commands/discuss.ts',
  'src/cli/commands/trd.ts',
  'src/cli/commands/stats.ts',
  'src/cli/commands/init.ts',
])

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
      const fromCap = relFile.split('/')[2]
      if (target.startsWith('src/capabilities/')) {
        const toCap = target.split('/')[2]
        if (fromCap && toCap && fromCap !== toCap) {
          violations.push(`${relFile} must not depend on another capability (${target})`)
        }
      }
    }

    if (relFile.startsWith('src/cli/')) {
      const allowed =
        target.startsWith('src/cli/') ||
        target.startsWith('src/core/capability/') ||
        target.startsWith('src/capabilities/')

      if (!allowed && !legacyCliBridgeAllowList.has(relFile)) {
        violations.push(`${relFile} has disallowed dependency (${target})`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Boundary check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Boundary check passed.')

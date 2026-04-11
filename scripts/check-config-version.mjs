#!/usr/bin/env node
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const root = process.cwd()

export const CONFIG_VERSION_SOURCE_PATH = 'src/platform/config/loader.ts'
export const CONFIG_CONTRACT_PATHS = [
  'src/platform/config/init.ts',
  'src/platform/config/loader.ts',
  'src/platform/config/types.ts',
]

function runGit(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim()
}

export function extractCurrentConfigVersion(sourceText) {
  const match = sourceText.match(/CURRENT_CONFIG_VERSION\s*=\s*(\d+)/)
  if (!match) {
    throw new Error(`Unable to find CURRENT_CONFIG_VERSION in ${CONFIG_VERSION_SOURCE_PATH}`)
  }
  return Number.parseInt(match[1], 10)
}

export function shouldRequireConfigVersionBump({ stagedFiles, previousVersion, nextVersion }) {
  const touchedContract = stagedFiles.some((file) => CONFIG_CONTRACT_PATHS.includes(file))
  if (!touchedContract) {
    return { required: false }
  }

  if (previousVersion === null) {
    return { required: false }
  }

  if (nextVersion > previousVersion) {
    return { required: false }
  }

  return {
    required: true,
    reason: 'Config contract files changed without a config version bump.',
  }
}

function getStagedFiles() {
  const output = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  return output ? output.split('\n').filter(Boolean) : []
}

function readBlob(spec) {
  try {
    return runGit(['show', spec])
  } catch {
    return null
  }
}

function getPreviousVersion() {
  const source = readBlob(`HEAD:${CONFIG_VERSION_SOURCE_PATH}`)
  if (!source) return null
  try {
    return extractCurrentConfigVersion(source)
  } catch {
    return null
  }
}

function getNextVersion() {
  const source = readBlob(`:${CONFIG_VERSION_SOURCE_PATH}`)
  if (!source) {
    const fallbackPath = path.join(root, CONFIG_VERSION_SOURCE_PATH)
    return extractCurrentConfigVersion(fs.readFileSync(fallbackPath, 'utf-8'))
  }
  return extractCurrentConfigVersion(source)
}

function main() {
  const stagedFiles = getStagedFiles()
  const touchedContract = stagedFiles.some((file) => CONFIG_CONTRACT_PATHS.includes(file))
  if (!touchedContract) {
    console.log('Config version check passed.')
    return
  }

  const decision = shouldRequireConfigVersionBump({
    stagedFiles,
    previousVersion: getPreviousVersion(),
    nextVersion: getNextVersion(),
  })

  if (!decision.required) {
    console.log('Config version check passed.')
    return
  }

  console.error('Config version check failed.')
  console.error(decision.reason)
  console.error(`Changed contract files: ${stagedFiles.filter((file) => CONFIG_CONTRACT_PATHS.includes(file)).join(', ')}`)
  console.error(`Update ${CONFIG_VERSION_SOURCE_PATH} to the next config version in the same commit.`)
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

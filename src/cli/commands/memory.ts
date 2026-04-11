import { execFileSync } from 'child_process'
import { Command } from 'commander'
import { readFileSync } from 'fs'
import { StateManager } from '../../state/state-manager.js'
import { listWorkflowSessions } from '../../capabilities/workflows/shared/runtime.js'
import { parseCommandArgs } from '../../capabilities/workflows/shared/runtime.js'
import {
  promoteKnowledgeCandidates,
  readKnowledgeCandidates,
  type KnowledgeCandidate,
} from '../../knowledge/runtime.js'
import {
  ensureMemoryFiles,
  getProjectMemoryPath,
  getUserMemoryPath,
  syncProjectMemoryFromPromotedKnowledge,
} from '../../memory/runtime.js'

interface MemoryScopeOptions {
  user?: boolean
  project?: boolean
}

function resolveScope(options: MemoryScopeOptions): 'user' | 'project' | 'both' {
  if (options.user && options.project) return 'both'
  if (options.user) return 'user'
  if (options.project) return 'project'
  return 'both'
}

async function resolveMemoryPaths(repoRoot: string) {
  const ensured = await ensureMemoryFiles(repoRoot)
  return {
    userPath: getUserMemoryPath(),
    projectPath: ensured.projectPath,
  }
}

function printMemory(label: string, path: string): void {
  console.log(`${label}: ${path}`)
  console.log(readFileSync(path, 'utf-8').trim())
  console.log('')
}

function openInEditor(path: string): void {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    console.log(`Memory file ready: ${path}`)
    return
  }

  const [file, ...args] = parseCommandArgs(editor)
  execFileSync(file, [...args, path], { stdio: 'inherit' })
}

async function findPromotableSession(sessionId: string, cwd: string) {
  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  const loopMatches = (await stateManager.listLoopSessions())
    .filter((session) => session.id === sessionId || session.id.startsWith(sessionId))
    .map((session) => ({
      capability: 'loop' as const,
      id: session.id,
      repoRootPath: session.artifacts.repoRootPath,
      knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath,
    }))

  const harnessMatches = (await listWorkflowSessions('harness'))
    .filter((session) => session.id === sessionId || session.id.startsWith(sessionId))
    .map((session) => ({
      capability: 'harness' as const,
      id: session.id,
      repoRootPath: session.artifacts.repoRootPath,
      knowledgeCandidatesPath: session.artifacts.knowledgeCandidatesPath,
    }))

  const matches = [...loopMatches, ...harnessMatches]
  if (matches.length === 0) {
    throw new Error(`No loop or harness session found matching "${sessionId}"`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple sessions match "${sessionId}", use the full id`)
  }
  return matches[0]
}

function promotedOrDeferred(candidates: KnowledgeCandidate[]): KnowledgeCandidate[] {
  return candidates.filter((candidate) => candidate.type === 'decision' || candidate.type === 'workflow-rule' || candidate.type === 'failure-pattern')
}

export async function runMemoryShow(options: MemoryScopeOptions, cwd = process.cwd()): Promise<void> {
  const scope = resolveScope(options)
  const paths = await resolveMemoryPaths(cwd)

  if (scope === 'user' || scope === 'both') {
    printMemory('User memory', paths.userPath)
  }
  if (scope === 'project' || scope === 'both') {
    printMemory('Project memory', paths.projectPath)
  }
}

export async function runMemoryEdit(options: MemoryScopeOptions, cwd = process.cwd()): Promise<void> {
  if (options.user && options.project) {
    throw new Error('Choose either --user or --project when editing memory')
  }

  const paths = await resolveMemoryPaths(cwd)
  const scope: 'user' | 'project' = options.user ? 'user' : 'project'

  openInEditor(scope === 'user' ? paths.userPath : paths.projectPath)
}

export async function runMemoryPromote(sessionId: string, cwd = process.cwd()): Promise<void> {
  const session = await findPromotableSession(sessionId, cwd)
  if (!session.knowledgeCandidatesPath) {
    throw new Error(`Session ${session.id} has no promotable knowledge candidates`)
  }

  const candidates = promotedOrDeferred(await readKnowledgeCandidates({
    knowledgeSchemaPath: '',
    knowledgeIndexPath: '',
    knowledgeLogPath: '',
    knowledgeStatePath: '',
    knowledgeSummaryDir: '',
    knowledgeCandidatesPath: session.knowledgeCandidatesPath,
  }))

  if (candidates.length === 0) {
    console.log(`No promotable knowledge candidates found in ${session.id}.`)
    return
  }

  const targetRepoRoot = session.repoRootPath || cwd
  const result = await promoteKnowledgeCandidates(targetRepoRoot, candidates)
  const memoryPath = await syncProjectMemoryFromPromotedKnowledge(targetRepoRoot, result.promoted)

  console.log(`Promoted: ${result.promoted.length}`)
  console.log(`Deferred: ${result.deferred.length}`)
  console.log(`Project memory: ${memoryPath}`)
  console.log(`Repository knowledge key: ${result.repoKey}`)
}

export const memoryCommand = new Command('memory')
  .description('Inspect and maintain persistent user/project memory')

memoryCommand
  .command('show')
  .description('Show user and project memory')
  .option('--user', 'Show only user memory')
  .option('--project', 'Show only project memory')
  .action(async (options: MemoryScopeOptions) => {
    await runMemoryShow(options)
  })

memoryCommand
  .command('edit')
  .description('Create the target memory file and open it in $EDITOR/$VISUAL when available')
  .option('--user', 'Edit user memory')
  .option('--project', 'Edit project memory (default)')
  .action(async (options: MemoryScopeOptions) => {
    await runMemoryEdit(options)
  })

memoryCommand
  .command('promote')
  .description('Promote loop/harness knowledge candidates into repository knowledge and project memory')
  .argument('<sessionId>', 'Loop or harness session ID or prefix')
  .action(async (sessionId: string) => {
    await runMemoryPromote(sessionId)
  })

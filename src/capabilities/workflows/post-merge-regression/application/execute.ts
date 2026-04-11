import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import { createOperationsRouter } from '../../../../platform/integrations/operations/factory.js'
import type { OperationsEvidenceRun } from '../../../../platform/integrations/operations/types.js'
import { createConfiguredProvider } from '../../../../platform/providers/index.js'
import {
  buildCommandSafetyConfig,
  enforceCommandSafety,
  generateWorkflowId,
  persistWorkflowSession,
  runSafeCommand,
  sessionDirFor,
} from '../../shared/runtime.js'
import type { PostMergeRegressionPreparedInput, PostMergeRegressionResult } from '../types.js'

export async function executePostMergeRegression(
  prepared: PostMergeRegressionPreparedInput,
  ctx: CapabilityContext
): Promise<PostMergeRegressionResult> {
  const config = loadConfig(ctx.configPath)
  const runtime = config.capabilities.post_merge_regression || {}
  const commandSafety = buildCommandSafetyConfig(config.capabilities.safety)
  const commands = prepared.commands || runtime.commands || []
  const sessionId = generateWorkflowId('post-merge-regression')
  const sessionDir = sessionDirFor('post-merge-regression', sessionId)
  const reportPath = join(sessionDir, 'regression-report.md')
  const evidencePath = join(sessionDir, 'evidence.json')
  await mkdir(sessionDir, { recursive: true })

  const operationsRouter = createOperationsRouter(config.integrations.operations)
  const interactive = process.stdin.isTTY && process.stdout.isTTY
  const blockedRuns = commands.map((command) => {
    const blocked = enforceCommandSafety(command, {
      safety: commandSafety,
      interactive,
    })
    if (!blocked) {
      return null
    }

    return {
      command,
      ...blocked,
    } satisfies OperationsEvidenceRun
  })

  const runnableCommands = commands.filter((_, index) => blockedRuns[index] === null)
  const executedEvidence = config.integrations.operations?.enabled
    ? await operationsRouter.collectEvidence({
        cwd: ctx.cwd,
        commands: runnableCommands,
      })
    : {
        runs: runnableCommands.map((command) => ({
          command,
          ...runSafeCommand(ctx.cwd, command, {
            safety: commandSafety,
            interactive,
          }),
        })),
        summary: runnableCommands.join('\n'),
      }
  const executedRuns = [...executedEvidence.runs]
  const mergedRuns: OperationsEvidenceRun[] = commands.map((command, index) => {
    const blocked = blockedRuns[index]
    if (blocked) {
      return blocked
    }

    return executedRuns.shift() || {
      command,
      passed: false,
      output: 'Missing execution result.',
    }
  })
  const evidence = {
    ...executedEvidence,
    runs: mergedRuns,
    summary: mergedRuns.map((run) => `${run.passed ? 'PASS' : 'FAIL'} ${run.command}`).join('\n'),
  }
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf-8')

  const evaluator = createConfiguredProvider({
    logicalName: 'capabilities.post_merge_regression.evaluator',
    model: runtime.evaluator_model || config.analyzer.model,
    agent: runtime.evaluator_agent,
  }, config)
  evaluator.setCwd?.(ctx.cwd)
  const prompt = `You are summarizing a post-merge regression run.\n\n${evidence.runs.map((result) => `Command: ${result.command}\nPassed: ${result.passed}\nOutput:\n${result.output}`).join('\n\n')}`
  const summary = await evaluator.chat([{ role: 'user', content: prompt }])
  await writeFile(reportPath, summary, 'utf-8')

  const session = {
    id: sessionId,
    capability: 'post-merge-regression' as const,
    title: 'Post-merge regression',
    createdAt: new Date(),
    updatedAt: new Date(),
    status: evidence.runs.every((result) => result.passed) ? 'completed' as const : 'failed' as const,
    summary,
    artifacts: {
      reportPath,
      evidencePath,
    },
    evidence,
  }
  await persistWorkflowSession(session)

  return {
    status: session.status,
    session,
  }
}

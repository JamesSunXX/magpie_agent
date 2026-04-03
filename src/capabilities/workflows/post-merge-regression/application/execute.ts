import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import { createOperationsRouter } from '../../../../platform/integrations/operations/factory.js'
import { createConfiguredProvider } from '../../../../platform/providers/index.js'
import {
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
  const commands = prepared.commands || runtime.commands || []
  const sessionId = generateWorkflowId('post-merge-regression')
  const sessionDir = sessionDirFor('post-merge-regression', sessionId)
  const reportPath = join(sessionDir, 'regression-report.md')
  const evidencePath = join(sessionDir, 'evidence.json')
  await mkdir(sessionDir, { recursive: true })

  const operationsRouter = createOperationsRouter(config.integrations.operations)
  const evidence = config.integrations.operations?.enabled
    ? await operationsRouter.collectEvidence({
        cwd: ctx.cwd,
        commands,
      })
    : {
        runs: commands.map((command) => ({
          command,
          ...runSafeCommand(ctx.cwd, command),
        })),
        summary: commands.join('\n'),
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

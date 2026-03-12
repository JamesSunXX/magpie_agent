import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { loadConfigV2 } from '../../../../platform/config/loader.js'
import { createProvider } from '../../../../providers/factory.js'
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
  const config = loadConfigV2(ctx.configPath)
  const runtime = config.capabilities.post_merge_regression || {}
  const commands = prepared.commands || runtime.commands || []
  const sessionId = generateWorkflowId('post-merge-regression')
  const sessionDir = sessionDirFor('post-merge-regression', sessionId)
  const reportPath = join(sessionDir, 'regression-report.md')
  await mkdir(sessionDir, { recursive: true })

  const results = commands.map((command) => ({
    command,
    ...runSafeCommand(ctx.cwd, command),
  }))

  const evaluator = createProvider(runtime.evaluator_model || config.analyzer.model, config)
  evaluator.setCwd?.(ctx.cwd)
  const prompt = `You are summarizing a post-merge regression run.\n\n${results.map((result) => `Command: ${result.command}\nPassed: ${result.passed}\nOutput:\n${result.output}`).join('\n\n')}`
  const summary = await evaluator.chat([{ role: 'user', content: prompt }])
  await writeFile(reportPath, summary, 'utf-8')

  const session = {
    id: sessionId,
    capability: 'post-merge-regression' as const,
    title: 'Post-merge regression',
    createdAt: new Date(),
    updatedAt: new Date(),
    status: results.every((result) => result.passed) ? 'completed' as const : 'failed' as const,
    summary,
    artifacts: {
      reportPath,
    },
  }
  await persistWorkflowSession(session)

  return {
    status: session.status,
    session,
  }
}

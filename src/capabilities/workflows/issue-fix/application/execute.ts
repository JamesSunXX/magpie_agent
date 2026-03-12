import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { createProvider } from '../../../../providers/factory.js'
import { loadConfigV2 } from '../../../../platform/config/loader.js'
import {
  generateWorkflowId,
  persistWorkflowSession,
  runSafeCommand,
  sessionDirFor,
} from '../../shared/runtime.js'
import type { IssueFixPreparedInput, IssueFixResult } from '../types.js'

export async function executeIssueFix(
  prepared: IssueFixPreparedInput,
  ctx: CapabilityContext
): Promise<IssueFixResult> {
  const config = loadConfigV2(ctx.configPath)
  const runtime = config.capabilities.issue_fix || {}
  const sessionId = generateWorkflowId('issue-fix')
  const sessionDir = sessionDirFor('issue-fix', sessionId)
  const planPath = join(sessionDir, 'plan.md')
  const executionPath = join(sessionDir, 'execution.md')
  const verificationPath = join(sessionDir, 'verification.txt')

  await mkdir(sessionDir, { recursive: true })

  const planner = createProvider(runtime.planner_model || config.analyzer.model, config)
  const executor = createProvider(runtime.executor_model || 'codex', config)
  planner.setCwd?.(ctx.cwd)
  executor.setCwd?.(ctx.cwd)

  const planPrompt = `You are triaging an engineering issue in this repository.\n\nIssue:\n${prepared.issue}\n\nCreate a concise execution plan with risks, likely files, and verification steps.`
  const plan = await planner.chat([{ role: 'user', content: planPrompt }])
  await writeFile(planPath, plan, 'utf-8')

  const executionPrompt = prepared.apply === false
    ? `Do not mutate files. Describe the exact code and test changes you would make for this issue.\n\nIssue:\n${prepared.issue}\n\nPlan:\n${plan}`
    : `Apply the minimum safe fix for this issue in the current repository, then summarize exactly what changed.\n\nIssue:\n${prepared.issue}\n\nPlan:\n${plan}`
  const execution = await executor.chat([{ role: 'user', content: executionPrompt }])
  await writeFile(executionPath, execution, 'utf-8')

  const verifyCommand = prepared.verifyCommand || runtime.verify_command
  let verificationOutput = ''
  let verificationPassed = true
  if (verifyCommand) {
    const verification = runSafeCommand(ctx.cwd, verifyCommand)
    verificationPassed = verification.passed
    verificationOutput = verification.output
    await writeFile(verificationPath, verification.output, 'utf-8')
  }

  const session = {
    id: sessionId,
    capability: 'issue-fix' as const,
    title: prepared.issue.slice(0, 80),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: verificationPassed ? 'completed' as const : 'failed' as const,
    summary: verificationPassed ? 'Issue fix workflow completed.' : 'Issue fix workflow failed verification.',
    artifacts: {
      planPath,
      executionPath,
      ...(verifyCommand ? { verificationPath } : {}),
    },
  }
  await persistWorkflowSession(session)

  return {
    status: verificationPassed ? 'completed' : 'failed',
    session,
  }
}

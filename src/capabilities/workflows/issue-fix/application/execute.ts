import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { createRoutingDecision, isRoutingEnabled } from '../../../routing/index.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import { createPlanningRouter } from '../../../../platform/integrations/planning/factory.js'
import {
  buildPlanningContextBlock,
  extractPlanningItemKey,
} from '../../../../platform/integrations/planning/index.js'
import { createConfiguredProvider } from '../../../../platform/providers/index.js'
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
  const log = ctx.logger
  const config = loadConfig(ctx.configPath)
  const runtime = config.capabilities.issue_fix || {}
  const planningRouter = createPlanningRouter(config.integrations.planning)
  const planningItemKey = prepared.planningItemKey
    || extractPlanningItemKey(prepared.issue)
  const sessionId = generateWorkflowId('issue-fix')
  const sessionDir = sessionDirFor('issue-fix', sessionId)
  const planPath = join(sessionDir, 'plan.md')
  const executionPath = join(sessionDir, 'execution.md')
  const verificationPath = join(sessionDir, 'verification.txt')
  const routingDecisionPath = join(sessionDir, 'routing-decision.json')

  log.debug(`[issue-fix] session=${sessionId} dir=${sessionDir}`)
  log.debug(`[issue-fix] issue=${prepared.issue} apply=${prepared.apply}`)
  log.debug(`[issue-fix] planningItem=${planningItemKey}`)

  await mkdir(sessionDir, { recursive: true })

  const routingDecision = isRoutingEnabled(config)
    ? createRoutingDecision({
      goal: prepared.issue,
      overrideTier: prepared.complexity,
      config,
    })
    : undefined

  if (routingDecision) {
    await writeFile(routingDecisionPath, JSON.stringify(routingDecision, null, 2), 'utf-8')
  }

  const plannerModel = routingDecision?.planning.model || runtime.planner_model || config.analyzer.model
  const executorModel = routingDecision?.execution.model || runtime.executor_model || 'codex'
  log.debug(`[issue-fix] planner=${plannerModel} executor=${executorModel}`)
  const planner = createConfiguredProvider({
    logicalName: 'capabilities.issue_fix.planner',
    model: plannerModel,
    agent: routingDecision?.planning.agent || runtime.planner_agent,
  }, config)
  const executor = createConfiguredProvider({
    logicalName: 'capabilities.issue_fix.executor',
    model: executorModel,
    agent: routingDecision?.execution.agent || runtime.executor_agent,
  }, config)
  planner.setCwd?.(ctx.cwd)
  executor.setCwd?.(ctx.cwd)

  log.debug('[issue-fix] fetching planning context...')
  const planningContext = await planningRouter.createPlanContext({
    itemKey: planningItemKey,
    title: prepared.issue,
  })
  const planningContextBlock = buildPlanningContextBlock(planningContext)
  log.debug(`[issue-fix] planning context: ${planningContext ? `provider=${planningContext.providerId} url=${planningContext.url} summary=${planningContext.summary ? 'yes' : 'none'}` : '(none)'}`)
  if (planningContext?.summary) {
    log.debug(`[issue-fix] jira data:\n${planningContext.summary}`)
  }

  log.debug(`[issue-fix] generating plan via ${plannerModel}...`)
  const planPrompt = [
    'You are triaging an engineering issue in this repository.',
    '',
    'Issue:',
    prepared.issue,
    ...(planningContextBlock ? ['', planningContextBlock] : []),
    '',
    'Create a concise execution plan with risks, likely files, and verification steps.',
  ].join('\n')
  const plan = await planner.chat([{ role: 'user', content: planPrompt }])
  await writeFile(planPath, plan, 'utf-8')
  log.debug(`[issue-fix] plan saved to ${planPath} (${plan.length} chars)`)

  log.debug(`[issue-fix] executing via ${executorModel} (apply=${prepared.apply !== false})...`)
  const executionPrompt = prepared.apply === false
    ? `Do not mutate files. Describe the exact code and test changes you would make for this issue.\n\nIssue:\n${prepared.issue}\n\nPlan:\n${plan}`
    : `Apply the minimum safe fix for this issue in the current repository, then summarize exactly what changed.\n\nIssue:\n${prepared.issue}\n\nPlan:\n${plan}`
  const execution = await executor.chat([{ role: 'user', content: executionPrompt }])
  await writeFile(executionPath, execution, 'utf-8')
  log.debug(`[issue-fix] execution saved to ${executionPath} (${execution.length} chars)`)

  const verifyCommand = prepared.verifyCommand || runtime.verify_command
  let verificationOutput = ''
  let verificationPassed = true
  if (verifyCommand) {
    log.debug(`[issue-fix] running verification: ${verifyCommand}`)
    const verification = runSafeCommand(ctx.cwd, verifyCommand)
    verificationPassed = verification.passed
    verificationOutput = verification.output
    await writeFile(verificationPath, verification.output, 'utf-8')
    log.debug(`[issue-fix] verification ${verificationPassed ? 'passed' : 'FAILED'} (${verificationOutput.length} chars output)`)
  } else {
    log.debug('[issue-fix] no verification command configured, skipping')
  }

  log.debug('[issue-fix] syncing artifact to planning provider...')
  const syncResult = await planningRouter.syncPlanArtifact({
    projectKey: planningContext?.projectKey,
    itemKey: planningContext?.itemKey || planningItemKey,
    title: prepared.issue,
    body: [
      `Issue: ${prepared.issue}`,
      '',
      'Plan:',
      plan,
      '',
      'Execution:',
      execution,
      ...(verifyCommand ? ['', `Verification (${verifyCommand}):`, verificationOutput] : []),
    ].join('\n'),
  })
  log.debug(`[issue-fix] artifact sync: synced=${syncResult.synced}`)

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
      ...(routingDecision ? { routingDecisionPath } : {}),
      ...(verifyCommand ? { verificationPath } : {}),
    },
  }
  await persistWorkflowSession(session)
  log.debug(`[issue-fix] session persisted, status=${session.status}`)

  return {
    status: verificationPassed ? 'completed' : 'failed',
    session,
  }
}

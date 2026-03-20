import type { BuiltCommand, SessionCard, TaskDraft, TaskId } from './types.js'

function shellQuote(value: string): string {
  if (!/[^\w./:-]/.test(value)) {
    return value
  }

  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

function displayCommand(argv: string[]): string {
  return ['magpie', ...argv].map(shellQuote).join(' ')
}

function maybePushBoolean(argv: string[], flag: string, value: string | boolean | undefined): void {
  if (value === true) {
    argv.push(flag)
  }
}

function maybePushText(argv: string[], flag: string, value: string | boolean | undefined): void {
  if (typeof value === 'string' && value.trim()) {
    argv.push(flag, value.trim())
  }
}

function maybePushDelimitedValues(
  argv: string[],
  flag: string,
  value: string | boolean | undefined
): void {
  if (typeof value !== 'string') {
    return
  }

  const entries = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (entries.length > 0) {
    argv.push(flag, ...entries)
  }
}

function appendReviewOptions(argv: string[], values: Record<string, string | boolean | undefined>): void {
  maybePushText(argv, '--reviewers', values.reviewers)
  maybePushBoolean(argv, '--all', values.all)
  maybePushBoolean(argv, '--quick', values.quick)
  maybePushBoolean(argv, '--deep', values.deep)

  if (values.format === 'json') {
    argv.push('--format', 'json')
  }

  maybePushText(argv, '--output', values.output)
}

export function buildTaskCommand(
  taskId: TaskId,
  values: Record<string, string | boolean | undefined>
): BuiltCommand {
  switch (taskId) {
    case 'change-review': {
      const argv = ['review']
      const mode = typeof values.mode === 'string' ? values.mode : 'local'

      if (mode === 'local') {
        argv.push('--local')
      } else if (mode === 'branch') {
        argv.push('--branch')
        if (typeof values.branchBase === 'string' && values.branchBase.trim()) {
          argv.push(values.branchBase.trim())
        }
      } else if (mode === 'files') {
        maybePushDelimitedValues(argv, '--files', values.files)
      } else if (mode === 'repo') {
        argv.push('--repo')
        maybePushText(argv, '--path', values.path)
        maybePushDelimitedValues(argv, '--ignore', values.ignore)
      }

      appendReviewOptions(argv, values)

      const summaryByMode: Record<string, string> = {
        local: 'Review local changes',
        branch: `Review the current branch against ${typeof values.branchBase === 'string' && values.branchBase.trim() ? values.branchBase.trim() : 'the default base branch'}`,
        files: 'Review selected files',
        repo: 'Review the repository scope',
      }

      return {
        argv,
        display: displayCommand(argv),
        summary: summaryByMode[mode] || 'Review code changes',
      }
    }
    case 'pr-review': {
      const pr = typeof values.pr === 'string' ? values.pr.trim() : ''
      const argv = ['review', pr]

      appendReviewOptions(argv, values)

      return {
        argv,
        display: displayCommand(argv),
        summary: `Review PR ${pr}`,
      }
    }
    case 'trd-generation': {
      const prdPath = typeof values.prdPath === 'string' ? values.prdPath.trim() : ''
      const argv = ['trd', prdPath]

      maybePushText(argv, '--reviewers', values.reviewers)
      maybePushBoolean(argv, '--all', values.all)
      maybePushText(argv, '--output', values.output)
      maybePushText(argv, '--questions-output', values.questionsOutput)
      maybePushBoolean(argv, '--auto-accept-domains', values.autoAcceptDomains)
      maybePushBoolean(argv, '--domain-overview-only', values.domainOverviewOnly)
      maybePushText(argv, '--domains-file', values.domainsFile)

      return {
        argv,
        display: displayCommand(argv),
        summary: `Generate a TRD from ${prdPath}`,
      }
    }
    case 'loop-run': {
      const goal = typeof values.goal === 'string' ? values.goal.trim() : ''
      const prdPath = typeof values.prdPath === 'string' ? values.prdPath.trim() : ''
      const argv = ['loop', 'run', goal, '--prd', prdPath]

      maybePushText(argv, '--planning-item', values.planningItem)
      if (values.waitHuman === false) {
        argv.push('--no-wait-human')
      }
      maybePushBoolean(argv, '--dry-run', values.dryRun)
      maybePushText(argv, '--max-iterations', values.maxIterations)

      return {
        argv,
        display: displayCommand(argv),
        summary: `Run the goal loop for "${goal}"`,
      }
    }
    case 'issue-fix': {
      const issue = typeof values.issue === 'string' ? values.issue.trim() : ''
      const argv = ['workflow', 'issue-fix', issue]

      maybePushBoolean(argv, '--apply', values.apply)
      maybePushText(argv, '--verify-command', values.verifyCommand)
      maybePushText(argv, '--planning-item', values.planningItem)

      return {
        argv,
        display: displayCommand(argv),
        summary: `Run the issue-fix workflow for "${issue}"`,
      }
    }
  }
}

export function buildCommandFromDraft(draft: TaskDraft): BuiltCommand {
  return buildTaskCommand(draft.taskId, draft.values)
}

export function buildResumeArgv(card: Pick<SessionCard, 'capability' | 'id' | 'resumeCommand'>): string[] | undefined {
  if (card.resumeCommand) {
    return [...card.resumeCommand]
  }

  switch (card.capability) {
    case 'review':
      return ['review', '--session', card.id]
    case 'discuss':
      return ['discuss', '--resume', card.id]
    case 'trd':
      return ['trd', '--resume', card.id]
    case 'loop':
      return ['loop', 'resume', card.id]
    default:
      return undefined
  }
}

export function buildResumeCommand(card: Pick<SessionCard, 'capability' | 'id' | 'resumeCommand'>): BuiltCommand | undefined {
  const argv = buildResumeArgv(card)
  if (!argv) {
    return undefined
  }

  return {
    argv,
    display: displayCommand(argv),
    summary: `Resume ${card.capability} session ${card.id}`,
  }
}

export function buildCommandDisplay(argv: string[]): string {
  return displayCommand(argv)
}

import { appendReviewOptions, buildCommandDisplay, maybePushBoolean, maybePushDelimitedValues, maybePushText } from './task-command-utils.js'
import type { BuiltCommand, ReviewMode, TaskDefinition, TaskDraft, TaskField, TaskFieldId, TaskId, TaskValues } from './types.js'

const reviewFormatOptions = [
  { label: 'Markdown', value: 'markdown' },
  { label: 'JSON', value: 'json' },
] as const

function createTextField<TId extends TaskFieldId>(field: Omit<TaskField<TId>, 'type'>): TaskField<TId> {
  return {
    ...field,
    type: 'text',
  }
}

function createToggleField<TId extends TaskFieldId>(field: Omit<TaskField<TId>, 'type'>): TaskField<TId> {
  return {
    ...field,
    type: 'toggle',
  }
}

function createSelectField<TId extends TaskFieldId>(field: Omit<TaskField<TId>, 'type'>): TaskField<TId> {
  return {
    ...field,
    type: 'select',
  }
}

function createReviewerFields(): TaskField[] {
  return [
    createTextField({
      id: 'reviewers',
      label: 'Reviewer IDs',
      advanced: true,
      placeholder: 'codex,claude-code',
    }),
    createToggleField({
      id: 'all',
      label: 'Use all reviewers',
      advanced: true,
    }),
  ]
}

function createFormatField(): TaskField<'format'> {
  return createSelectField({
    id: 'format',
    label: 'Output format',
    advanced: true,
    options: [...reviewFormatOptions],
  })
}

function createOutputField(label = 'Output path', placeholder = './review.md'): TaskField<'output'> {
  return createTextField({
    id: 'output',
    label,
    advanced: true,
    placeholder,
  })
}

function buildChangeReviewCommand(values: TaskValues): BuiltCommand {
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

    // TUI runs cannot answer follow-up prompts, so repo reviews default to deep mode.
    if (values.quick !== true && values.deep !== true) {
      argv.push('--deep')
    }
  }

  appendReviewOptions(argv, values)

  const summaryByMode: Record<ReviewMode, string> = {
    local: 'Review local changes',
    branch: `Review the current branch against ${typeof values.branchBase === 'string' && values.branchBase.trim() ? values.branchBase.trim() : 'the default base branch'}`,
    files: 'Review selected files',
    repo: 'Review the repository scope',
  }

  return {
    argv,
    display: buildCommandDisplay(argv),
    summary: summaryByMode[mode as ReviewMode] || 'Review code changes',
  }
}

function buildPrReviewCommand(values: TaskValues): BuiltCommand {
  const pr = typeof values.pr === 'string' ? values.pr.trim() : ''
  const argv = ['review', pr]

  appendReviewOptions(argv, values)

  return {
    argv,
    display: buildCommandDisplay(argv),
    summary: `Review PR ${pr}`,
  }
}

function buildTrdCommand(values: TaskValues): BuiltCommand {
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
    display: buildCommandDisplay(argv),
    summary: `Generate a TRD from ${prdPath}`,
  }
}

function buildLoopRunCommand(values: TaskValues): BuiltCommand {
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
    display: buildCommandDisplay(argv),
    summary: `Run the goal loop for "${goal}"`,
  }
}

function buildIssueFixCommand(values: TaskValues): BuiltCommand {
  const issue = typeof values.issue === 'string' ? values.issue.trim() : ''
  const argv = ['workflow', 'issue-fix', issue]

  maybePushBoolean(argv, '--apply', values.apply)
  maybePushText(argv, '--verify-command', values.verifyCommand)
  maybePushText(argv, '--planning-item', values.planningItem)

  return {
    argv,
    display: buildCommandDisplay(argv),
    summary: `Run the issue-fix workflow for "${issue}"`,
  }
}

export const TASKS: TaskDefinition[] = [
  {
    id: 'change-review',
    title: '评审改动',
    description: 'Review local changes, a branch diff, selected files, or a repository slice.',
    defaults: {
      mode: 'local',
      format: 'markdown',
    },
    fields: [
      createSelectField({
        id: 'mode',
        label: 'Review mode',
        options: [
          { label: 'Local changes', value: 'local' },
          { label: 'Branch diff', value: 'branch' },
          { label: 'Specific files', value: 'files' },
          { label: 'Repository scan', value: 'repo' },
        ],
      }),
      createTextField({
        id: 'branchBase',
        label: 'Base branch',
        placeholder: 'main',
        visibleWhen: (values) => values.mode === 'branch',
      }),
      createTextField({
        id: 'files',
        label: 'Files (comma-separated)',
        required: true,
        placeholder: 'src/cli/program.ts, tests/cli/program.test.ts',
        visibleWhen: (values) => values.mode === 'files',
      }),
      createTextField({
        id: 'path',
        label: 'Repository path',
        placeholder: 'src',
        visibleWhen: (values) => values.mode === 'repo',
      }),
      createTextField({
        id: 'ignore',
        label: 'Ignore patterns',
        placeholder: 'dist, coverage',
        visibleWhen: (values) => values.mode === 'repo',
      }),
      ...createReviewerFields(),
      createToggleField({
        id: 'quick',
        label: 'Quick review only',
        advanced: true,
      }),
      createToggleField({
        id: 'deep',
        label: 'Deep review',
        advanced: true,
      }),
      createFormatField(),
      createOutputField(),
    ],
    buildCommand: buildChangeReviewCommand,
  },
  {
    id: 'pr-review',
    title: '评审 PR',
    description: 'Review a pull request by number or URL.',
    defaults: {
      format: 'markdown',
    },
    fields: [
      createTextField({
        id: 'pr',
        label: 'PR number or URL',
        required: true,
        placeholder: '12345',
      }),
      ...createReviewerFields(),
      createFormatField(),
    ],
    buildCommand: buildPrReviewCommand,
  },
  {
    id: 'trd-generation',
    title: '生成 TRD',
    description: 'Generate a TRD from a PRD markdown document.',
    defaults: {},
    fields: [
      createTextField({
        id: 'prdPath',
        label: 'PRD path',
        required: true,
        placeholder: './docs/prd.md',
      }),
      ...createReviewerFields(),
      createOutputField('TRD output path', './docs/trd.md'),
      createTextField({
        id: 'questionsOutput',
        label: 'Questions output path',
        advanced: true,
        placeholder: './docs/open-questions.md',
      }),
      createToggleField({
        id: 'autoAcceptDomains',
        label: 'Auto-accept draft domains',
        advanced: true,
      }),
      createToggleField({
        id: 'domainOverviewOnly',
        label: 'Only generate domain overview',
        advanced: true,
      }),
      createTextField({
        id: 'domainsFile',
        label: 'Confirmed domains file',
        advanced: true,
        placeholder: './docs/domains.confirmed.yaml',
      }),
    ],
    buildCommand: buildTrdCommand,
  },
  {
    id: 'loop-run',
    title: '目标闭环 Loop',
    description: 'Run the goal-driven loop workflow from a goal and PRD.',
    defaults: {
      waitHuman: true,
    },
    fields: [
      createTextField({
        id: 'goal',
        label: 'Goal',
        required: true,
        placeholder: 'Deliver checkout v2',
      }),
      createTextField({
        id: 'prdPath',
        label: 'PRD path',
        required: true,
        placeholder: './docs/prd.md',
      }),
      createTextField({
        id: 'planningItem',
        label: 'Planning item key',
        advanced: true,
        placeholder: 'ENG-123',
      }),
      createToggleField({
        id: 'waitHuman',
        label: 'Wait for human confirmation',
        advanced: true,
      }),
      createToggleField({
        id: 'dryRun',
        label: 'Dry run',
        advanced: true,
      }),
      createTextField({
        id: 'maxIterations',
        label: 'Max iterations',
        advanced: true,
        placeholder: '5',
      }),
    ],
    buildCommand: buildLoopRunCommand,
  },
  {
    id: 'issue-fix',
    title: '问题修复',
    description: 'Plan and execute an issue triage and fix workflow.',
    defaults: {},
    fields: [
      createTextField({
        id: 'issue',
        label: 'Issue summary',
        required: true,
        placeholder: 'loop resume fails after human rejection',
      }),
      createToggleField({
        id: 'apply',
        label: 'Allow code changes',
        advanced: true,
      }),
      createTextField({
        id: 'verifyCommand',
        label: 'Verification command',
        advanced: true,
        placeholder: 'npm run test:run',
      }),
      createTextField({
        id: 'planningItem',
        label: 'Planning item key',
        advanced: true,
        placeholder: 'ENG-123',
      }),
    ],
    buildCommand: buildIssueFixCommand,
  },
]

export function getTaskDefinition(taskId: TaskId): TaskDefinition {
  const task = TASKS.find((candidate) => candidate.id === taskId)
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`)
  }
  return task
}

export function createTaskDraft(taskId: TaskId): TaskDraft {
  const task = getTaskDefinition(taskId)
  return {
    taskId,
    values: { ...task.defaults },
    showAdvanced: false,
  }
}

import type { TaskDefinition, TaskDraft, TaskField, TaskId } from './types.js'

const reviewModeField: TaskField = {
  id: 'mode',
  label: 'Review mode',
  type: 'select',
  options: [
    { label: 'Local changes', value: 'local' },
    { label: 'Branch diff', value: 'branch' },
    { label: 'Specific files', value: 'files' },
    { label: 'Repository scan', value: 'repo' },
  ],
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
      reviewModeField,
      {
        id: 'branchBase',
        label: 'Base branch',
        type: 'text',
        placeholder: 'main',
        visibleWhen: (values) => values.mode === 'branch',
      },
      {
        id: 'files',
        label: 'Files (comma-separated)',
        type: 'text',
        placeholder: 'src/cli/program.ts, tests/cli/program.test.ts',
        visibleWhen: (values) => values.mode === 'files',
      },
      {
        id: 'path',
        label: 'Repository path',
        type: 'text',
        placeholder: 'src',
        visibleWhen: (values) => values.mode === 'repo',
      },
      {
        id: 'ignore',
        label: 'Ignore patterns',
        type: 'text',
        placeholder: 'dist, coverage',
        visibleWhen: (values) => values.mode === 'repo',
      },
      {
        id: 'reviewers',
        label: 'Reviewer IDs',
        type: 'text',
        advanced: true,
        placeholder: 'codex,claude-code',
      },
      {
        id: 'all',
        label: 'Use all reviewers',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'quick',
        label: 'Quick review only',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'deep',
        label: 'Deep review',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'format',
        label: 'Output format',
        type: 'select',
        advanced: true,
        options: [
          { label: 'Markdown', value: 'markdown' },
          { label: 'JSON', value: 'json' },
        ],
      },
      {
        id: 'export',
        label: 'Export path',
        type: 'text',
        advanced: true,
        placeholder: './review.md',
      },
    ],
  },
  {
    id: 'pr-review',
    title: '评审 PR',
    description: 'Review a pull request by number or URL.',
    defaults: {
      format: 'markdown',
    },
    fields: [
      {
        id: 'pr',
        label: 'PR number or URL',
        type: 'text',
        required: true,
        placeholder: '12345',
      },
      {
        id: 'reviewers',
        label: 'Reviewer IDs',
        type: 'text',
        advanced: true,
        placeholder: 'codex,claude-code',
      },
      {
        id: 'all',
        label: 'Use all reviewers',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'format',
        label: 'Output format',
        type: 'select',
        advanced: true,
        options: [
          { label: 'Markdown', value: 'markdown' },
          { label: 'JSON', value: 'json' },
        ],
      },
    ],
  },
  {
    id: 'trd-generation',
    title: '生成 TRD',
    description: 'Generate a TRD from a PRD markdown document.',
    defaults: {},
    fields: [
      {
        id: 'prdPath',
        label: 'PRD path',
        type: 'text',
        required: true,
        placeholder: './docs/prd.md',
      },
      {
        id: 'reviewers',
        label: 'Reviewer IDs',
        type: 'text',
        advanced: true,
        placeholder: 'codex,claude-code',
      },
      {
        id: 'all',
        label: 'Use all reviewers',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'output',
        label: 'TRD output path',
        type: 'text',
        advanced: true,
        placeholder: './docs/trd.md',
      },
      {
        id: 'questionsOutput',
        label: 'Questions output path',
        type: 'text',
        advanced: true,
        placeholder: './docs/open-questions.md',
      },
      {
        id: 'autoAcceptDomains',
        label: 'Auto-accept draft domains',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'domainOverviewOnly',
        label: 'Only generate domain overview',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'domainsFile',
        label: 'Confirmed domains file',
        type: 'text',
        advanced: true,
        placeholder: './docs/domains.confirmed.yaml',
      },
    ],
  },
  {
    id: 'loop-run',
    title: '目标闭环 Loop',
    description: 'Run the goal-driven loop workflow from a goal and PRD.',
    defaults: {
      waitHuman: true,
    },
    fields: [
      {
        id: 'goal',
        label: 'Goal',
        type: 'text',
        required: true,
        placeholder: 'Deliver checkout v2',
      },
      {
        id: 'prdPath',
        label: 'PRD path',
        type: 'text',
        required: true,
        placeholder: './docs/prd.md',
      },
      {
        id: 'planningItem',
        label: 'Planning item key',
        type: 'text',
        advanced: true,
        placeholder: 'ENG-123',
      },
      {
        id: 'waitHuman',
        label: 'Wait for human confirmation',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'dryRun',
        label: 'Dry run',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'maxIterations',
        label: 'Max iterations',
        type: 'text',
        advanced: true,
        placeholder: '5',
      },
    ],
  },
  {
    id: 'issue-fix',
    title: '问题修复',
    description: 'Plan and execute an issue triage and fix workflow.',
    defaults: {},
    fields: [
      {
        id: 'issue',
        label: 'Issue summary',
        type: 'text',
        required: true,
        placeholder: 'loop resume fails after human rejection',
      },
      {
        id: 'apply',
        label: 'Allow code changes',
        type: 'toggle',
        advanced: true,
      },
      {
        id: 'verifyCommand',
        label: 'Verification command',
        type: 'text',
        advanced: true,
        placeholder: 'npm run test:run',
      },
      {
        id: 'planningItem',
        label: 'Planning item key',
        type: 'text',
        advanced: true,
        placeholder: 'ENG-123',
      },
    ],
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

export const FEISHU_TASK_FORM_SUBMIT_ACTION = 'submit_task_form'

export function buildFeishuTaskFormCard(): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: 'Create Magpie task',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: [
          'Fill the fields below to create a new Magpie task.',
          '- `type`: `small` or `formal`',
          '- `priority` only matters for `formal` tasks',
        ].join('\n'),
      },
      {
        tag: 'input',
        name: 'task_type',
        placeholder: {
          tag: 'plain_text',
          content: 'small or formal',
        },
      },
      {
        tag: 'input',
        name: 'goal',
        placeholder: {
          tag: 'plain_text',
          content: 'Task goal',
        },
      },
      {
        tag: 'input',
        name: 'prd',
        placeholder: {
          tag: 'plain_text',
          content: 'docs/plans/example.md',
        },
      },
      {
        tag: 'input',
        name: 'priority',
        placeholder: {
          tag: 'plain_text',
          content: 'interactive, high, normal, or background',
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'Submit task',
            },
            type: 'primary',
            value: {
              action: FEISHU_TASK_FORM_SUBMIT_ACTION,
            },
          },
        ],
      },
    ],
  }
}

import { describe, expect, it } from 'vitest'
import {
  buildFeishuTaskFormCard,
  FEISHU_TASK_FORM_SUBMIT_ACTION,
} from '../../../src/platform/integrations/im/feishu/task-form.js'

describe('buildFeishuTaskFormCard', () => {
  it('builds the task creation card with the expected fields and submit action', () => {
    const card = buildFeishuTaskFormCard()
    const inputs = card.elements?.filter(
      (element): element is { tag: string; name?: string } =>
        typeof element === 'object' && element !== null && 'tag' in element && element.tag === 'input',
    ) ?? []
    const markdown = card.elements?.find(
      (element): element is { tag: string; content?: string } =>
        typeof element === 'object' && element !== null && 'tag' in element && element.tag === 'markdown',
    )
    const action = card.elements?.find(
      (element): element is {
        tag: string
        actions?: Array<{ text?: { tag?: string; content?: string }; value?: { action?: string } }>
      } =>
        typeof element === 'object' && element !== null && 'tag' in element && element.tag === 'action',
    )

    expect(card).toEqual({
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
      elements: expect.arrayContaining([
        expect.objectContaining({
          tag: 'input',
          name: 'type',
        }),
        expect.objectContaining({
          tag: 'input',
          name: 'goal',
        }),
        expect.objectContaining({
          tag: 'input',
          name: 'prd',
        }),
        expect.objectContaining({
          tag: 'input',
          name: 'priority',
        }),
        expect.objectContaining({
          tag: 'action',
          actions: [
            expect.objectContaining({
              value: {
                action: FEISHU_TASK_FORM_SUBMIT_ACTION,
              },
            }),
          ],
        }),
      ]),
    })
    expect(inputs).toHaveLength(4)
    expect(inputs.map((input) => input.name)).toEqual(['type', 'goal', 'prd', 'priority'])
    expect(markdown?.content).toContain('`type`: `small` or `formal`')
    expect(markdown?.content).toContain('`priority` only matters for `formal` tasks')
    expect(action?.actions).toEqual([
      expect.objectContaining({
        text: {
          tag: 'plain_text',
          content: 'Submit task',
        },
        value: {
          action: FEISHU_TASK_FORM_SUBMIT_ACTION,
        },
      }),
    ])
  })
})

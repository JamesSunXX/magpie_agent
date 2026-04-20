import { describe, expect, it } from 'vitest'
import {
  buildFeishuTaskFormCard,
  FEISHU_TASK_FORM_SUBMIT_ACTION,
} from '../../../src/platform/integrations/im/feishu/task-form.js'

describe('buildFeishuTaskFormCard', () => {
  it('builds the task creation card with the expected fields and submit action', () => {
    const card = buildFeishuTaskFormCard()

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
          name: 'task_type',
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
  })
})

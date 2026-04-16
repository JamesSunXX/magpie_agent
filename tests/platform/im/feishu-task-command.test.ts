import { describe, expect, it } from 'vitest'
import { parseFeishuTaskCommand } from '../../../src/platform/integrations/im/feishu/task-command.js'

describe('parseFeishuTaskCommand', () => {
  it('normalizes a small-task command into a loop request', () => {
    const request = parseFeishuTaskCommand('/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md')

    expect(request).toEqual({
      entryMode: 'command',
      taskType: 'small',
      capability: 'loop',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
      priority: undefined,
    })
  })

  it('normalizes a formal task command into a harness request', () => {
    const request = parseFeishuTaskCommand('/magpie task\ntype: formal\ngoal: Deliver payment retry flow\nprd: docs/plans/payment-retry.md\npriority: high')

    expect(request).toEqual({
      entryMode: 'command',
      taskType: 'formal',
      capability: 'harness',
      goal: 'Deliver payment retry flow',
      prdPath: 'docs/plans/payment-retry.md',
      priority: 'high',
    })
  })

  it('fails when required fields are missing', () => {
    expect(() => parseFeishuTaskCommand('/magpie task\ngoal: Missing type')).toThrow('missing required field: type')
  })
})

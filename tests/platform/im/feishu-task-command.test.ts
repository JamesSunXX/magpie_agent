import { describe, expect, it } from 'vitest'
import {
  isFeishuTaskFormText,
  parseFeishuTaskCommand,
  parseFeishuTaskForm,
} from '../../../src/platform/integrations/im/feishu/task-command.js'

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

  it('rejects command lines without a colon separator', () => {
    expect(() => parseFeishuTaskCommand('/magpie task\ntype small')).toThrow('invalid command line: type small')
  })

  it('rejects unsupported task types', () => {
    expect(() => parseFeishuTaskCommand('/magpie task\ntype: medium\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md')).toThrow('unsupported task type: medium')
  })

  it('rejects unsupported priorities', () => {
    expect(() => parseFeishuTaskCommand('/magpie task\ntype: formal\ngoal: Deliver payment retry flow\nprd: docs/plans/payment-retry.md\npriority: urgent')).toThrow('unsupported priority: urgent')
  })

  it('detects the form-open command header', () => {
    expect(isFeishuTaskFormText('/magpie form')).toBe(true)
    expect(isFeishuTaskFormText('/magpie task')).toBe(false)
  })

  it('normalizes a form submission into a harness request', () => {
    const request = parseFeishuTaskForm({
      taskType: 'formal',
      goal: 'Deliver payment retry flow',
      prdPath: 'docs/plans/payment-retry.md',
      priority: 'high',
    })

    expect(request).toEqual({
      entryMode: 'form',
      taskType: 'formal',
      capability: 'harness',
      goal: 'Deliver payment retry flow',
      prdPath: 'docs/plans/payment-retry.md',
      priority: 'high',
    })
  })

  it('rejects invalid form submissions with the same validation rules', () => {
    expect(() => parseFeishuTaskForm({
      taskType: 'small',
      goal: '',
      prdPath: 'docs/plans/login-timeout.md',
    })).toThrow('missing required field: goal')
  })
})

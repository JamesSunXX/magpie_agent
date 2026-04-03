import { describe, expect, it } from 'vitest'
import { getTaskDefinition } from '../../src/tui/tasks.js'

describe('tui tasks', () => {
  it('keeps command building with the task definition', () => {
    const task = getTaskDefinition('issue-fix')

    expect(task.buildCommand({
      issue: 'Fix dashboard crash',
      apply: true,
    })).toEqual({
      argv: ['workflow', 'issue-fix', 'Fix dashboard crash', '--apply'],
      display: 'magpie workflow issue-fix "Fix dashboard crash" --apply',
      summary: 'Run the issue-fix workflow for "Fix dashboard crash"',
    })
  })
})

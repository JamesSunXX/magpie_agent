import { describe, expect, it } from 'vitest'
import { getCollaborationTemplate } from '../../src/core/roles/templates.js'

describe('collaboration templates', () => {
  it('defines clear role responsibilities for formal requirement delivery', () => {
    const template = getCollaborationTemplate('formal_requirement')

    expect(template.title).toBe('Formal requirement')
    expect(template.roles.map((role) => role.roleType)).toEqual([
      'architect',
      'developer',
      'tester',
      'reviewer',
      'arbitrator',
    ])
    expect(template.roles.every((role) => role.responsibility.length > 0)).toBe(true)
  })
})

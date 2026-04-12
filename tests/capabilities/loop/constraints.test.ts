import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  createConstraintsSnapshot,
  evaluatePlanningConstraints,
  loadLoopConstraints,
} from '../../../src/capabilities/loop/domain/constraints.js'

describe('loop constraints', () => {
  it('loads repo-local constraints from .magpie/constraints.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-constraints-'))
    mkdirSync(join(dir, '.magpie'), { recursive: true })
    writeFileSync(join(dir, '.magpie', 'constraints.json'), JSON.stringify({
      version: 1,
      sourcePrdPath: '/tmp/prd.md',
      sourceTrdPath: '/tmp/trd.md',
      generatedAt: '2026-04-12T00:00:00.000Z',
      rules: [
        {
          id: 'dependency-no-axios',
          category: 'dependency',
          description: '禁止引入 axios',
          severity: 'error',
          scope: 'repository',
          checkType: 'forbidden_dependency',
          expected: [],
          forbidden: ['axios'],
        },
      ],
    }, null, 2), 'utf-8')

    const loaded = await loadLoopConstraints(dir)

    expect(loaded?.rules[0]?.forbidden).toEqual(['axios'])
  })

  it('returns blocked when a forbidden dependency is called out in the task intent', () => {
    const result = evaluatePlanningConstraints({
      stage: 'code_development',
      goal: 'Use axios to fetch checkout data',
      stageTasks: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Build checkout API client',
          description: 'Use axios in the implementation',
          dependencies: [],
          successCriteria: [],
        },
      ],
      constraints: {
        version: 1,
        sourcePrdPath: '/tmp/prd.md',
        sourceTrdPath: '/tmp/trd.md',
        generatedAt: '2026-04-12T00:00:00.000Z',
        rules: [
          {
            id: 'dependency-no-axios',
            category: 'dependency',
            description: '禁止引入 axios',
            severity: 'error',
            scope: 'repository',
            checkType: 'forbidden_dependency',
            expected: [],
            forbidden: ['axios'],
          },
        ],
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.matchedRuleIds).toEqual(['dependency-no-axios'])
  })

  it('returns needs_revision when a required path is not reflected in the current plan', () => {
    const result = evaluatePlanningConstraints({
      stage: 'code_development',
      goal: 'Implement checkout BFF endpoint',
      stageTasks: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Implement checkout endpoint',
          description: 'Add the endpoint implementation',
          dependencies: [],
          successCriteria: [],
        },
      ],
      constraints: {
        version: 1,
        sourcePrdPath: '/tmp/prd.md',
        sourceTrdPath: '/tmp/trd.md',
        generatedAt: '2026-04-12T00:00:00.000Z',
        rules: [
          {
            id: 'path-required-src-bff-checkout',
            category: 'path',
            description: '相关实现应放在 src/bff/checkout',
            severity: 'warning',
            scope: 'changed_files',
            checkType: 'required_path_prefix',
            expected: ['src/bff/checkout'],
            forbidden: [],
          },
        ],
      },
    })

    expect(result.status).toBe('needs_revision')
    expect(result.matchedRuleIds).toEqual(['path-required-src-bff-checkout'])
  })

  it('writes a session-local constraints snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-constraints-snapshot-'))
    mkdirSync(join(dir, '.magpie', 'sessions', 'loop', 'loop-1'), { recursive: true })

    const snapshotPath = await createConstraintsSnapshot(
      join(dir, '.magpie', 'sessions', 'loop', 'loop-1'),
      {
        version: 1,
        sourcePrdPath: '/tmp/prd.md',
        sourceTrdPath: '/tmp/trd.md',
        generatedAt: '2026-04-12T00:00:00.000Z',
        rules: [],
      }
    )

    expect(snapshotPath).toContain('constraints.snapshot.json')
  })
})

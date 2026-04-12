import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  assessTddEligibility,
  createTddTarget,
  recordRedTestResult,
} from '../../../src/capabilities/loop/domain/tdd.js'

describe('loop TDD helpers', () => {
  it('marks utility and transform tasks as TDD-eligible', () => {
    const result = assessTddEligibility({
      goal: 'Add amount formatter utility',
      stageTasks: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Format checkout amount',
          description: 'Implement a pure string formatting helper',
          dependencies: [],
          successCriteria: [],
        },
      ],
    })

    expect(result.eligible).toBe(true)
  })

  it('marks UI-heavy tasks as not TDD-eligible in the first version', () => {
    const result = assessTddEligibility({
      goal: 'Build a browser checkout page',
      stageTasks: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Render React checkout page',
          description: 'Implement browser interactions and visual layout',
          dependencies: [],
          successCriteria: [],
        },
      ],
    })

    expect(result.eligible).toBe(false)
  })

  it('writes a TDD target artifact under the session directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-tdd-target-'))
    const targetPath = await createTddTarget({
      sessionDir: dir,
      goal: 'Normalize card number input',
      stageTasks: [
        {
          id: 'task-1',
          stage: 'code_development',
          title: 'Normalize card number',
          description: 'Implement pure input normalization',
          dependencies: [],
          successCriteria: ['Normalization output is deterministic'],
        },
      ],
    })

    expect(existsSync(targetPath)).toBe(true)
    expect(readFileSync(targetPath, 'utf-8')).toContain('Normalize card number')
  })

  it('writes a red-test result artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-loop-tdd-red-'))
    const resultPath = await recordRedTestResult(dir, {
      command: 'node -e "process.exit(1)"',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:01.000Z',
      exitCode: 1,
      status: 'failed',
      output: 'red test failed as expected',
      confirmed: true,
    })

    expect(existsSync(resultPath)).toBe(true)
    expect(readFileSync(resultPath, 'utf-8')).toContain('"confirmed": true')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildFallbackStageNotificationMessage,
  type StageNotificationSummaryInput,
} from '../../../src/platform/integrations/notifications/stage-summary.js'

function buildInput(eventType: StageNotificationSummaryInput['eventType']): StageNotificationSummaryInput {
  return {
    eventType,
    sessionId: 'loop-1',
    capability: 'loop',
    runTitle: 'Deliver feature',
    projectName: 'magpie',
    projectPath: '/Users/sunchenhui/Documents/AI/magpie',
    stage: 'code_development',
    occurrence: 2,
    summary: 'Running code changes.',
    nextAction: 'Edit controller and tests.',
    blocker: 'none',
    aiRoster: [
      { id: 'codex', role: 'main execution' },
      { id: 'kiro:architect', role: 'risk review' },
    ],
  }
}

describe('buildFallbackStageNotificationMessage', () => {
  it('renders project details, session, occurrence, ai list, and responsibilities', () => {
    const result = buildFallbackStageNotificationMessage(buildInput('stage_entered'))

    expect(result.title).toContain('magpie')
    expect(result.title).toContain('loop-1')
    expect(result.title).toContain('code_development')
    expect(result.body).toContain('项目: magpie')
    expect(result.body).toContain('路径: /Users/sunchenhui/Documents/AI/magpie')
    expect(result.body).toContain('第 2 次')
    expect(result.body).toContain('codex')
    expect(result.body).toContain('main execution')
    expect(result.body).toContain('Edit controller and tests.')
  })

  it('renders blocker details for failure events', () => {
    const result = buildFallbackStageNotificationMessage({
      ...buildInput('stage_failed'),
      blocker: 'unit tests failed',
      nextAction: 'Inspect failing test output.',
    })

    expect(result.body).toContain('unit tests failed')
    expect(result.body).toContain('Inspect failing test output.')
  })
})

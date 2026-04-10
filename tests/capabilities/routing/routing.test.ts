import { describe, expect, it } from 'vitest'
import {
  createRoutingDecision,
  escalateRoutingDecision,
  getRouteBindings,
} from '../../../src/capabilities/routing/index.js'
import type { MagpieConfigV2 } from '../../../src/platform/config/types.js'

function createConfig(): MagpieConfigV2 {
  return {
    defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
    providers: {
      'gemini-cli': { enabled: true },
      codex: { enabled: true },
      kiro: { enabled: true },
    },
    reviewers: {
      'route-gemini': { tool: 'gemini', prompt: 'route gemini' },
      'route-codex': { tool: 'codex', prompt: 'route codex' },
      'route-architect': { tool: 'kiro', agent: 'architect', prompt: 'route architect' },
    },
    summarizer: { model: 'codex', prompt: 'summarize' },
    analyzer: { model: 'codex', prompt: 'analyze' },
    capabilities: {
      routing: {
        enabled: true,
      },
    },
    integrations: {
      notifications: { enabled: false },
    },
  }
}

describe('routing', () => {
  it('scores a short low-risk request as simple', () => {
    const decision = createRoutingDecision({
      goal: 'Rename a typo in one command help string.',
      config: createConfig(),
    })

    expect(decision.schemaVersion).toBe(1)
    expect(decision.tier).toBe('simple')
    expect(decision.score).toBeLessThanOrEqual(2)
  })

  it('applies the configured default tier when there are no strong signals', () => {
    const config = createConfig()
    config.capabilities.routing = {
      enabled: true,
      default_tier: 'standard',
    }

    const decision = createRoutingDecision({
      goal: 'Rename a typo.',
      config,
    })

    expect(decision.tier).toBe('standard')
  })

  it('keeps short high-risk work out of the simple tier', () => {
    const decision = createRoutingDecision({
      goal: 'Patch auth migration rollback bug.',
      config: createConfig(),
    })

    expect(decision.tier).not.toBe('simple')
  })

  it('scores a cross-cutting risky request as complex', () => {
    const decision = createRoutingDecision({
      goal: 'Add payment migration with database changes, public API updates, auth checks, performance constraints, and external integration rollback planning.',
      prdContent: '# PRD\n\nAdd payment migration with rollback compatibility for auth, database and public API integration.',
      tasks: [
        {
          id: 'task-1',
          stage: 'prd_review',
          title: 'Review PRD',
          description: 'Review auth and payment plan',
          dependencies: [],
          successCriteria: ['done'],
        },
        {
          id: 'task-2',
          stage: 'domain_partition',
          title: 'Split domains',
          description: 'Touch api/payment/auth/database',
          dependencies: ['task-1'],
          successCriteria: ['done'],
        },
        {
          id: 'task-3',
          stage: 'trd_generation',
          title: 'Generate TRD',
          description: 'Cover rollback and compatibility',
          dependencies: ['task-2'],
          successCriteria: ['done'],
        },
        {
          id: 'task-4',
          stage: 'code_development',
          title: 'Implement',
          description: 'Change public API and concurrency-sensitive paths',
          dependencies: ['task-3'],
          successCriteria: ['done'],
        },
      ],
      config: createConfig(),
    })

    expect(decision.tier).toBe('complex')
    expect(decision.score).toBeGreaterThanOrEqual(6)
    expect(decision.reviewerIds).toEqual(['route-gemini', 'route-codex', 'route-architect'])
  })

  it('honors an explicit complexity override', () => {
    const decision = createRoutingDecision({
      goal: 'Rename a typo in one command help string.',
      overrideTier: 'complex',
      config: createConfig(),
    })

    expect(decision.tier).toBe('complex')
    expect(decision.reasons).toContain('manual_override:complex')
  })

  it('returns complex planning and execution bindings with distinct kiro agents', () => {
    const bindings = getRouteBindings(createConfig(), 'complex')

    expect(bindings.planning).toEqual({ tool: 'kiro', agent: 'architect' })
    expect(bindings.execution).toEqual({ tool: 'kiro', agent: 'dev' })
  })

  it('falls back within the same route when a selected provider is disabled', () => {
    const config = createConfig()
    config.providers.kiro = { enabled: false }

    const decision = createRoutingDecision({
      goal: 'Implement a database migration with rollback, external integration, and auth changes.',
      overrideTier: 'complex',
      config,
    })

    expect(decision.tier).toBe('complex')
    expect(decision.planning).toEqual({ tool: 'codex' })
    expect(decision.execution).toEqual({ tool: 'codex' })
    expect(decision.reviewerIds).toEqual(['route-gemini', 'route-codex'])
    expect(decision.fallbackTrail).toEqual([
      'planning_fallback:complex:kiro::architect->codex::',
      'execution_fallback:complex:kiro::dev->codex::',
      'reviewer_fallback:complex:route-gemini,route-codex,route-architect->route-gemini,route-codex',
    ])
  })

  it('honors configured fallback chains before using built-in defaults', () => {
    const config = createConfig()
    config.providers['gemini-cli'] = { enabled: false }
    config.capabilities.routing = {
      enabled: true,
      fallback_chain: {
        planning: {
          simple: [{ tool: 'kiro', agent: 'architect' }],
        },
      },
    }

    const decision = createRoutingDecision({
      goal: 'Rename a typo in one command help string.',
      overrideTier: 'simple',
      config,
    })

    expect(decision.planning).toEqual({ tool: 'kiro', agent: 'architect' })
    expect(decision.execution).toEqual({ tool: 'codex' })
    expect(decision.fallbackTrail).toContain('planning_fallback:simple:gemini::->kiro::architect')
  })

  it('escalates upward only and records the escalation reason', () => {
    const first = createRoutingDecision({
      goal: 'Rename a typo in one command help string.',
      config: createConfig(),
    })

    const second = escalateRoutingDecision(first, createConfig(), 'high_severity_issue')
    const third = escalateRoutingDecision(second, createConfig(), 'tests_failed')

    expect(first.tier).toBe('simple')
    expect(second.tier).toBe('standard')
    expect(third.tier).toBe('complex')
    expect(third.escalationTrail).toEqual([
      'high_severity_issue',
      'tests_failed',
    ])
  })

  it('respects allow_runtime_escalation when escalation is disabled', () => {
    const config = createConfig()
    config.capabilities.routing = {
      enabled: true,
      allow_runtime_escalation: false,
    }

    const first = createRoutingDecision({
      goal: 'Rename a typo in one command help string.',
      config,
    })
    const second = escalateRoutingDecision(first, config, 'tests_failed')

    expect(second.tier).toBe(first.tier)
    expect(second.escalationTrail).toEqual([])
  })
})

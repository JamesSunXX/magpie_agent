import { describe, expect, it } from 'vitest'
import {
  assertSkillManifestReady,
  listResolvedSkills,
  resolveSkillManifestForCapability,
} from '../../../src/core/skills/catalog.js'
import type { MagpieConfigV2 } from '../../../src/platform/config/types.js'

function createConfig(): MagpieConfigV2 {
  return {
    defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
    providers: {
      codex: { enabled: true },
      kiro: { enabled: true },
      'gemini-cli': { enabled: true },
    },
    reviewers: {},
    summarizer: { tool: 'codex', prompt: 'summarize' },
    analyzer: { tool: 'codex', prompt: 'analyze' },
    capabilities: {
      skills: {
        enabled: true,
        defaults: {
          loop: ['guided-onboarding', 'task-state'],
          harness: ['multi-role-delivery'],
        },
      },
    },
    integrations: {
      notifications: { enabled: false },
    },
  }
}

describe('skills catalog', () => {
  it('lists configured skills with enabled state and dependency readiness', () => {
    const skills = listResolvedSkills(createConfig())

    expect(skills.map((skill) => skill.id)).toContain('guided-onboarding')
    expect(skills.find((skill) => skill.id === 'guided-onboarding')).toMatchObject({
      enabled: true,
      ready: true,
    })
  })

  it('builds a capability skill manifest and reports missing required tools', () => {
    const config = createConfig()
    config.providers.kiro = { enabled: false }

    const manifest = resolveSkillManifestForCapability({
      capabilityId: 'harness',
      config,
    })

    expect(manifest.enabled).toBe(true)
    expect(manifest.skills).toEqual(['multi-role-delivery'])
    expect(manifest.missingRequiredTools).toEqual(['kiro'])
    expect(manifest.ready).toBe(false)
    expect(() => assertSkillManifestReady(manifest)).toThrow('Capability harness cannot start because required skills are unavailable')
  })

  it('treats an explicitly enabled skill as active even when global skill defaults are off', () => {
    const config = createConfig()
    config.capabilities.skills = {
      enabled: false,
      defaults: {},
      overrides: {
        'multi-role-delivery': { enabled: true },
      },
    }
    config.providers.kiro = { enabled: false }

    const manifest = resolveSkillManifestForCapability({
      capabilityId: 'harness',
      config,
    })

    expect(manifest.enabled).toBe(true)
    expect(manifest.skills).toEqual(['multi-role-delivery'])
    expect(manifest.missingRequiredTools).toEqual(['kiro'])
    expect(manifest.ready).toBe(false)
    expect(() => assertSkillManifestReady(manifest)).toThrow('missing tools kiro')
  })
})

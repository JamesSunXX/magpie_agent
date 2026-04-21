import { getProviderForTool } from '../../providers/factory.js'
import type { MagpieConfigV2 } from '../../platform/config/types.js'

export type SkillRuntimeCapabilityId =
  | 'review'
  | 'discuss'
  | 'trd'
  | 'loop'
  | 'harness'
  | 'issue-fix'
  | 'docs-sync'
  | 'post-merge-regression'
  | 'quality/unit-test-eval'
  | 'stats'
  | 'status'

export interface SkillDefinition {
  id: string
  title: string
  purpose: string
  capabilities: SkillRuntimeCapabilityId[]
  requiredTools: string[]
}

export interface ResolvedSkill extends SkillDefinition {
  enabled: boolean
  ready: boolean
  missingRequiredTools: string[]
}

export interface CapabilitySkillManifest {
  schemaVersion: 1
  capabilityId: SkillRuntimeCapabilityId
  enabled: boolean
  skills: string[]
  missingRequiredTools: string[]
  ready: boolean
}

export const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    id: 'guided-onboarding',
    title: 'Guided onboarding',
    purpose: 'Prepare a first usable Magpie setup and point the user to the next task.',
    capabilities: ['review', 'loop', 'harness', 'status'],
    requiredTools: ['codex'],
  },
  {
    id: 'task-state',
    title: 'Task state summary',
    purpose: 'Summarize task state, blockers, and next actions for local and Feishu views.',
    capabilities: ['loop', 'harness', 'status'],
    requiredTools: [],
  },
  {
    id: 'multi-role-delivery',
    title: 'Multi-role delivery',
    purpose: 'Coordinate planner, executor, reviewer, and arbitrator roles for formal delivery.',
    capabilities: ['harness'],
    requiredTools: ['kiro', 'codex'],
  },
  {
    id: 'feishu-control',
    title: 'Feishu control',
    purpose: 'Use Feishu as the control surface for task creation, status, confirmation, and failure hints.',
    capabilities: ['harness', 'loop', 'status'],
    requiredTools: [],
  },
]

function isToolAvailable(config: MagpieConfigV2, tool: string): boolean {
  const providerName = getProviderForTool(tool)
  if (
    providerName === 'claude-code'
    || providerName === 'codex'
    || providerName === 'claw'
    || providerName === 'gemini-cli'
    || providerName === 'qwen-code'
    || providerName === 'kiro'
  ) {
    return config.providers?.[providerName]?.enabled !== false
  }
  return Boolean(config.providers?.[providerName])
}

function defaultSkillIdsForCapability(config: MagpieConfigV2, capabilityId: SkillRuntimeCapabilityId): string[] {
  const configured = config.capabilities.skills?.defaults?.[capabilityId]
  if (Array.isArray(configured)) {
    return configured
  }
  return BUILT_IN_SKILLS
    .filter((skill) => skill.capabilities.includes(capabilityId))
    .map((skill) => skill.id)
}

function isSkillEnabled(config: MagpieConfigV2, skillId: string, defaultEnabled: boolean): boolean {
  const override = config.capabilities.skills?.overrides?.[skillId]
  if (typeof override?.enabled === 'boolean') {
    return override.enabled
  }
  return defaultEnabled
}

export function listResolvedSkills(config: MagpieConfigV2): ResolvedSkill[] {
  const globallyEnabled = config.capabilities.skills?.enabled === true
  const defaultEnabledIds = new Set(
    Object.values(config.capabilities.skills?.defaults || {})
      .flat()
      .filter((id): id is string => typeof id === 'string')
  )

  return BUILT_IN_SKILLS.map((skill) => {
    const enabled = isSkillEnabled(config, skill.id, globallyEnabled && defaultEnabledIds.has(skill.id))
    const missingRequiredTools = skill.requiredTools.filter((tool) => !isToolAvailable(config, tool))
    return {
      ...skill,
      enabled,
      missingRequiredTools,
      ready: missingRequiredTools.length === 0,
    }
  })
}

export function resolveSkillManifestForCapability(input: {
  capabilityId: SkillRuntimeCapabilityId
  config: MagpieConfigV2
}): CapabilitySkillManifest {
  const defaultsEnabled = input.config.capabilities.skills?.enabled === true
  const defaultSkillIds = new Set(defaultSkillIdsForCapability(input.config, input.capabilityId))
  const skills = listResolvedSkills(input.config)
    .filter((skill) => skill.capabilities.includes(input.capabilityId))
    .filter((skill) => {
      const override = input.config.capabilities.skills?.overrides?.[skill.id]
      if (override?.enabled === true) return true
      if (override?.enabled === false) return false
      return defaultsEnabled && defaultSkillIds.has(skill.id)
    })
  const missingRequiredTools = [...new Set(skills.flatMap((skill) => skill.missingRequiredTools))]
  const enabled = defaultsEnabled || skills.length > 0

  return {
    schemaVersion: 1,
    capabilityId: input.capabilityId,
    enabled,
    skills: skills.map((skill) => skill.id),
    missingRequiredTools,
    ready: missingRequiredTools.length === 0,
  }
}

export function assertSkillManifestReady(manifest: CapabilitySkillManifest): void {
  if (manifest.ready) return
  throw new Error(
    `Capability ${manifest.capabilityId} cannot start because required skills are unavailable: missing tools ${manifest.missingRequiredTools.join(', ')}. Enable the provider, disable the skill, or update capabilities.skills before retrying.`
  )
}

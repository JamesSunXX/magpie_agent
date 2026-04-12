import type { RoleBinding, RoleInstance, RoleType } from './types.js'

export interface RoleBindingsConfig {
  architect?: RoleBinding
  developer?: RoleBinding
  tester?: RoleBinding
  reviewers?: RoleBinding[]
  arbitrator?: RoleBinding
  namedReviewers?: Record<string, RoleBinding>
}

export interface ResolvedRoleBindings {
  architect?: RoleBinding
  developer?: RoleBinding
  tester?: RoleBinding
  reviewers: RoleBinding[]
  arbitrator?: RoleBinding
  namedReviewers: Record<string, RoleBinding>
}

const ROLE_RESPONSIBILITIES: Record<RoleType, string> = {
  architect: 'Plan the work and keep boundaries clear.',
  developer: 'Implement the requested change.',
  tester: 'Confirm expected behavior and capture failures.',
  reviewer: 'Inspect the result and raise actionable issues.',
  arbitrator: 'Resolve conflicting signals into the next action.',
}

function normalizeBinding(binding: RoleBinding | undefined): RoleBinding | undefined {
  if (!binding) return undefined

  const tool = binding.tool?.trim()
  const model = binding.model?.trim()
  const agent = binding.agent?.trim()

  if (!tool && !model) {
    throw new Error('Role binding must include a non-empty tool or model')
  }

  return {
    ...(tool ? { tool } : {}),
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
  }
}

function normalizeBindings(bindings: RoleBinding[] | undefined): RoleBinding[] {
  return (bindings || []).map((binding) => normalizeBinding(binding) as RoleBinding)
}

function normalizeNamedBindings(bindings: Record<string, RoleBinding> | undefined): Record<string, RoleBinding> {
  const normalized: Record<string, RoleBinding> = {}
  for (const [name, binding] of Object.entries(bindings || {})) {
    normalized[name] = normalizeBinding(binding) as RoleBinding
  }
  return normalized
}

export function resolveRoleBindings(
  explicit: RoleBindingsConfig | undefined,
  fallbacks: RoleBindingsConfig = {}
): ResolvedRoleBindings {
  return {
    architect: normalizeBinding(explicit?.architect || fallbacks.architect),
    developer: normalizeBinding(explicit?.developer || fallbacks.developer),
    tester: normalizeBinding(explicit?.tester || fallbacks.tester),
    reviewers: normalizeBindings(explicit?.reviewers || fallbacks.reviewers),
    arbitrator: normalizeBinding(explicit?.arbitrator || fallbacks.arbitrator),
    namedReviewers: {
      ...normalizeNamedBindings(fallbacks.namedReviewers),
      ...normalizeNamedBindings(explicit?.namedReviewers),
    },
  }
}

function createRole(roleId: string, roleType: RoleType, binding: RoleBinding): RoleInstance {
  return {
    roleId,
    roleType,
    displayName: roleId,
    binding,
    responsibility: ROLE_RESPONSIBILITIES[roleType],
    capabilities: [roleType],
  }
}

export function buildRoleRoster(bindings: ResolvedRoleBindings): RoleInstance[] {
  const roles: RoleInstance[] = []

  if (bindings.architect) roles.push(createRole('architect', 'architect', bindings.architect))
  if (bindings.developer) roles.push(createRole('developer', 'developer', bindings.developer))
  if (bindings.tester) roles.push(createRole('tester', 'tester', bindings.tester))

  bindings.reviewers.forEach((binding, index) => {
    roles.push(createRole(`reviewer-${index + 1}`, 'reviewer', binding))
  })

  if (bindings.arbitrator) roles.push(createRole('arbitrator', 'arbitrator', bindings.arbitrator))

  return roles
}

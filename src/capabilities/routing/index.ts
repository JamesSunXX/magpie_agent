import type { LoopTask } from '../../state/types.js'
import { getProviderForModel, getProviderForTool } from '../../providers/factory.js'
import type {
  ComplexityTier,
  MagpieConfigV2,
  ModelRouteBinding,
  ReviewerPoolPolicy,
  RoutingConfig,
  RoutingDecision,
  RoutingSignalBreakdown,
} from '../../platform/config/types.js'
import {
  assertSkillManifestReady,
  resolveSkillManifestForCapability,
} from '../../core/skills/catalog.js'

export type RuntimeCapabilityId =
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

export interface CapabilityToolManifest {
  schemaVersion: 1
  capabilityId: RuntimeCapabilityId
  enabled: boolean
  tools: string[]
  requiredTools: string[]
  optionalTools: string[]
  disabledTools: string[]
  blockedTools: string[]
  missingRequiredTools: string[]
  skills?: string[]
  missingRequiredSkillTools?: string[]
  ready: boolean
}

const DEFAULT_THRESHOLDS = {
  simple_max: 2,
  standard_max: 5,
  complex_min: 6,
} as const

const DEFAULT_KEYWORDS = [
  'auth',
  'payment',
  'migration',
  'security',
  'database',
  'public api',
  'performance',
  'concurrency',
]

const DEFAULT_REVIEWER_POOLS: Required<ReviewerPoolPolicy> = {
  simple: ['route-gemini', 'route-codex'],
  standard: ['route-codex', 'route-architect'],
  complex: ['route-gemini', 'route-codex', 'route-architect'],
}

const DEFAULT_PLANNING_BINDINGS: Record<ComplexityTier, ModelRouteBinding> = {
  simple: { tool: 'gemini' },
  standard: { tool: 'codex' },
  complex: { tool: 'kiro', agent: 'architect' },
}

const DEFAULT_EXECUTION_BINDINGS: Record<ComplexityTier, ModelRouteBinding> = {
  simple: { tool: 'gemini' },
  standard: { tool: 'codex' },
  complex: { tool: 'kiro', agent: 'dev' },
}

// Keep fallback chains close to the preferred tier so degraded routing still lands
// on a tool that can reasonably finish the same class of work.
const DEFAULT_FALLBACK_CHAIN = {
  planning: {
    simple: [{ tool: 'codex' }],
    standard: [{ tool: 'gemini' }],
    complex: [{ tool: 'codex' }, { tool: 'gemini' }],
  },
  execution: {
    simple: [{ tool: 'codex' }],
    standard: [{ tool: 'gemini' }],
    complex: [{ tool: 'codex' }, { tool: 'gemini' }],
  },
} as const

const DEFAULT_REVIEWER_FALLBACK_ORDER: Record<ComplexityTier, string[]> = {
  simple: ['route-gemini', 'route-codex', 'route-architect'],
  standard: ['route-codex', 'route-architect', 'route-gemini'],
  complex: ['route-gemini', 'route-codex', 'route-architect'],
}

function resolveRuntimeCapabilityToggle(
  config: MagpieConfigV2,
  capabilityId: RuntimeCapabilityId
): boolean | undefined {
  switch (capabilityId) {
    case 'review':
      return config.capabilities.review?.enabled
    case 'discuss':
      return config.capabilities.discuss?.enabled
    case 'trd':
      return config.capabilities.trd?.enabled
    case 'loop':
      return config.capabilities.loop?.enabled
    case 'harness':
      return config.capabilities.harness?.enabled
    case 'issue-fix':
      return config.capabilities.issue_fix?.enabled
    case 'docs-sync':
      return config.capabilities.docs_sync?.enabled
    case 'post-merge-regression':
      return config.capabilities.post_merge_regression?.enabled
    case 'quality/unit-test-eval':
      return config.capabilities.quality?.unitTestEval?.enabled
    case 'stats':
      return true
    default:
      return true
  }
}

/**
 * Capability toggles default to enabled to preserve backwards compatibility with
 * existing configs. Only an explicit `enabled: false` disables a capability.
 */
export function isRuntimeCapabilityEnabled(
  config: MagpieConfigV2,
  capabilityId: RuntimeCapabilityId
): boolean {
  return resolveRuntimeCapabilityToggle(config, capabilityId) !== false
}

export function listEnabledRuntimeCapabilities(
  config: MagpieConfigV2
): RuntimeCapabilityId[] {
  const all: RuntimeCapabilityId[] = [
    'review',
    'discuss',
    'trd',
    'loop',
    'harness',
    'issue-fix',
    'docs-sync',
    'post-merge-regression',
    'quality/unit-test-eval',
    'stats',
  ]

  return all.filter((capabilityId) => isRuntimeCapabilityEnabled(config, capabilityId))
}

function cloneBinding(binding: ModelRouteBinding): ModelRouteBinding {
  return {
    ...(binding.tool ? { tool: binding.tool } : {}),
    ...(binding.model ? { model: binding.model } : {}),
    ...(binding.agent ? { agent: binding.agent } : {}),
  }
}

function canonicalToolName(tool: string): string {
  const provider = getProviderForTool(tool)
  if (provider === 'claude-code') return 'claude'
  if (provider === 'gemini-cli') return 'gemini'
  return provider
}

function canonicalToolNameFromModel(model: string): string | null {
  const provider = getProviderForModel(model)
  if (provider === 'claude-code') return 'claude'
  if (provider === 'gemini-cli') return 'gemini'
  if (
    provider === 'codex'
    || provider === 'claw'
    || provider === 'qwen-code'
    || provider === 'kiro'
  ) {
    return provider
  }
  return null
}

function collectBindingTool(binding: ModelRouteBinding | undefined): string | null {
  if (!binding) return null
  try {
    if (binding.tool) return canonicalToolName(binding.tool)
    if (binding.model) return canonicalToolNameFromModel(binding.model)
  } catch {
    return null
  }
  return null
}

function uniqueTools(tools: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tool of tools) {
    if (!tool) continue
    const canonical = canonicalToolName(tool)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    result.push(canonical)
  }
  return result
}

function isToolProviderEnabled(config: MagpieConfigV2, tool: string): boolean {
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
  return true
}

export function resolveCapabilityToolManifest(input: {
  capabilityId: RuntimeCapabilityId
  config: MagpieConfigV2
  routeBindings?: ModelRouteBinding[]
  reviewerIds?: string[]
  extraBindings?: ModelRouteBinding[]
}): CapabilityToolManifest {
  const policy = input.config.capabilities.tool_loading?.capabilities?.[input.capabilityId]
  const enabled = input.config.capabilities.tool_loading?.enabled === true
  const routeTools = uniqueTools([
    ...(input.routeBindings || []).map(collectBindingTool),
    ...(input.extraBindings || []).map(collectBindingTool),
    ...(input.reviewerIds || []).map((reviewerId) => {
      const reviewer = input.config.reviewers?.[reviewerId]
      return collectBindingTool(reviewer)
    }),
  ])
  const requiredTools = uniqueTools([...(policy?.required || []), ...routeTools])
  const optionalTools = uniqueTools(policy?.optional || [])
  const globallyDisabled = input.config.capabilities.tool_loading?.globally_disabled || []
  const disabledTools = uniqueTools([...(policy?.disabled || []), ...globallyDisabled])
  const allowedTools = policy?.allowed ? new Set(uniqueTools(policy.allowed)) : null
  const blockedTools = requiredTools.filter(tool =>
    disabledTools.includes(tool) || (allowedTools !== null && !allowedTools.has(tool))
  )
  const missingRequiredTools = requiredTools.filter(tool => !isToolProviderEnabled(input.config, tool))
  const skillManifest = resolveSkillManifestForCapability({
    capabilityId: input.capabilityId,
    config: input.config,
  })
  const ready = (!enabled || (blockedTools.length === 0 && missingRequiredTools.length === 0))
    && skillManifest.ready

  return {
    schemaVersion: 1,
    capabilityId: input.capabilityId,
    enabled,
    tools: requiredTools,
    requiredTools,
    optionalTools,
    disabledTools,
    blockedTools,
    missingRequiredTools,
    skills: skillManifest.skills,
    missingRequiredSkillTools: skillManifest.missingRequiredTools,
    ready,
  }
}

export function assertCapabilityToolManifestReady(manifest: CapabilityToolManifest): void {
  if (manifest.ready) return
  const reasons = [
    manifest.blockedTools.length > 0 ? `blocked tools: ${manifest.blockedTools.join(', ')}` : '',
    manifest.missingRequiredTools.length > 0 ? `missing required tools: ${manifest.missingRequiredTools.join(', ')}` : '',
    (manifest.missingRequiredSkillTools || []).length > 0 ? `missing skill tools: ${manifest.missingRequiredSkillTools?.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  if ((manifest.missingRequiredSkillTools || []).length > 0 && reasons === `missing skill tools: ${manifest.missingRequiredSkillTools?.join(', ')}`) {
    assertSkillManifestReady({
      schemaVersion: 1,
      capabilityId: manifest.capabilityId,
      enabled: true,
      skills: manifest.skills || [],
      missingRequiredTools: manifest.missingRequiredSkillTools || [],
      ready: false,
    })
  }
  throw new Error(`Capability ${manifest.capabilityId} cannot start because required tools are unavailable: ${reasons}. Enable the provider or update capabilities.tool_loading before retrying.`)
}

function getRoutingConfig(config: MagpieConfigV2): RoutingConfig {
  return config.capabilities.routing || {}
}

function getThresholds(config: MagpieConfigV2) {
  const thresholds = getRoutingConfig(config).thresholds || {}
  return {
    simple_max: thresholds.simple_max ?? DEFAULT_THRESHOLDS.simple_max,
    standard_max: thresholds.standard_max ?? DEFAULT_THRESHOLDS.standard_max,
    complex_min: thresholds.complex_min ?? DEFAULT_THRESHOLDS.complex_min,
  }
}

function getReviewerPools(config: MagpieConfigV2): Required<ReviewerPoolPolicy> {
  const reviewerPools = getRoutingConfig(config).reviewer_pools || {}
  return {
    simple: reviewerPools.simple || DEFAULT_REVIEWER_POOLS.simple,
    standard: reviewerPools.standard || DEFAULT_REVIEWER_POOLS.standard,
    complex: reviewerPools.complex || DEFAULT_REVIEWER_POOLS.complex,
  }
}

function getPlanningBindings(config: MagpieConfigV2): Record<ComplexityTier, ModelRouteBinding> {
  const planning = getRoutingConfig(config).stage_policies?.planning || {}
  return {
    simple: cloneBinding(planning.simple || DEFAULT_PLANNING_BINDINGS.simple),
    standard: cloneBinding(planning.standard || DEFAULT_PLANNING_BINDINGS.standard),
    complex: cloneBinding(planning.complex || DEFAULT_PLANNING_BINDINGS.complex),
  }
}

function getExecutionBindings(config: MagpieConfigV2): Record<ComplexityTier, ModelRouteBinding> {
  const execution = getRoutingConfig(config).stage_policies?.execution || {}
  return {
    simple: cloneBinding(execution.simple || DEFAULT_EXECUTION_BINDINGS.simple),
    standard: cloneBinding(execution.standard || DEFAULT_EXECUTION_BINDINGS.standard),
    complex: cloneBinding(execution.complex || DEFAULT_EXECUTION_BINDINGS.complex),
  }
}

type BindingStage = 'planning' | 'execution'

function getFallbackBindings(
  config: MagpieConfigV2,
  stage: BindingStage,
  tier: ComplexityTier
): ModelRouteBinding[] {
  const configured = getRoutingConfig(config).fallback_chain?.[stage]?.[tier] || []
  const defaults = DEFAULT_FALLBACK_CHAIN[stage][tier]
  return [...configured, ...defaults].map(cloneBinding)
}

function bindingKey(binding: ModelRouteBinding): string {
  return `${binding.tool || ''}:${binding.model || ''}:${binding.agent || ''}`
}

function dedupeBindings(bindings: ModelRouteBinding[]): ModelRouteBinding[] {
  const seen = new Set<string>()
  const unique: ModelRouteBinding[] = []

  for (const binding of bindings) {
    const key = bindingKey(binding)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(cloneBinding(binding))
  }

  return unique
}

// Routing config can name tools that are temporarily disabled or unavailable; this
// walks the preferred binding plus fallbacks and records when we had to degrade.
function isBindingAvailable(config: MagpieConfigV2, binding: ModelRouteBinding): boolean {
  const providerName = binding.tool
    ? getProviderForTool(binding.tool)
    : binding.model
      ? getProviderForModel(binding.model)
      : null

  if (!providerName) {
    return false
  }

  if (providerName === 'mock') {
    return true
  }

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

function resolveBinding(
  config: MagpieConfigV2,
  stage: BindingStage,
  tier: ComplexityTier,
  primary: ModelRouteBinding,
): { binding: ModelRouteBinding; trail: string[] } {
  const candidates = dedupeBindings([primary, ...getFallbackBindings(config, stage, tier)])
  const available = candidates.find(binding => isBindingAvailable(config, binding))

  if (!available) {
    return {
      binding: cloneBinding(primary),
      trail: [`${stage}_fallback_exhausted:${tier}:${bindingKey(primary)}`],
    }
  }

  if (bindingKey(available) === bindingKey(primary)) {
    return {
      binding: cloneBinding(available),
      trail: [],
    }
  }

  return {
    binding: cloneBinding(available),
    trail: [`${stage}_fallback:${tier}:${bindingKey(primary)}->${bindingKey(available)}`],
  }
}

function isReviewerAvailable(config: MagpieConfigV2, reviewerId: string): boolean {
  const reviewer = config.reviewers?.[reviewerId]
  if (!reviewer) return false
  return isBindingAvailable(config, { tool: reviewer.tool, model: reviewer.model, agent: reviewer.agent })
}

function resolveReviewerIds(
  config: MagpieConfigV2,
  tier: ComplexityTier,
  basePool: string[]
): { reviewerIds: string[]; trail: string[] } {
  const candidates = [...basePool, ...DEFAULT_REVIEWER_FALLBACK_ORDER[tier]]
  const uniqueCandidates = [...new Set(candidates)]
  const available = uniqueCandidates.filter(id => isReviewerAvailable(config, id))
  const desiredCount = Math.max(1, basePool.length)
  const reviewerIds = available.slice(0, desiredCount)

  if (reviewerIds.length === 0) {
    return {
      reviewerIds: [...basePool],
      trail: [`reviewer_fallback_exhausted:${tier}:${basePool.join(',')}`],
    }
  }

  if (reviewerIds.join(',') === basePool.join(',')) {
    return {
      reviewerIds,
      trail: [],
    }
  }

  return {
    reviewerIds,
    trail: [`reviewer_fallback:${tier}:${basePool.join(',')}->${reviewerIds.join(',')}`],
  }
}

function collectTopLevelSubsystems(paths: string[] | undefined): number {
  if (!paths || paths.length === 0) return 0
  const roots = new Set(paths.map(path => path.split('/').filter(Boolean)[0]).filter(Boolean))
  return roots.size
}

function scoreTextLength(text: string): number {
  if (text.length >= 1200) return 2
  if (text.length >= 400) return 1
  return 0
}

function scoreTaskCount(tasks: LoopTask[] | undefined): number {
  if (!tasks || tasks.length === 0) return 0
  if (tasks.length >= 6) return 2
  if (tasks.length >= 3) return 1
  return 0
}

function scoreDependencies(tasks: LoopTask[] | undefined): number {
  if (!tasks || tasks.length === 0) return 0
  const count = tasks.reduce((sum, task) => sum + task.dependencies.length, 0)
  if (count >= 4) return 1
  return 0
}

function scoreStages(tasks: LoopTask[] | undefined): number {
  if (!tasks || tasks.length === 0) return 0
  const stages = new Set(tasks.map(task => task.stage))
  if (stages.size >= 4) return 2
  if (stages.size >= 2) return 1
  return 0
}

function scoreKeywords(text: string, config: MagpieConfigV2): number {
  const source = text.toLowerCase()
  const keywords = getRoutingConfig(config).high_risk_keywords || DEFAULT_KEYWORDS
  const hitCount = keywords.filter(keyword => source.includes(keyword.toLowerCase())).length
  return Math.min(2, hitCount)
}

function scoreSubsystems(paths: string[] | undefined): number {
  const count = collectTopLevelSubsystems(paths)
  if (count >= 3) return 2
  if (count >= 2) return 1
  return 0
}

function scoreRollout(text: string): number {
  const source = text.toLowerCase()
  const markers = ['rollback', 'compatibility', 'data change', 'external integration', 'public api']
  return Math.min(2, markers.filter(marker => source.includes(marker)).length)
}

// Keep routing explainable: every signal is a small additive heuristic that can be
// surfaced back to the user instead of hiding the decision behind one opaque score.
function scoreSignals(
  text: string,
  tasks: LoopTask[] | undefined,
  relatedPaths: string[] | undefined,
  config: MagpieConfigV2
): RoutingSignalBreakdown {
  return {
    textLengthScore: scoreTextLength(text),
    taskCountScore: scoreTaskCount(tasks),
    dependencyScore: scoreDependencies(tasks),
    stageScore: scoreStages(tasks),
    keywordScore: scoreKeywords(text, config),
    subsystemScore: scoreSubsystems(relatedPaths),
    rolloutScore: scoreRollout(text),
  }
}

function sumSignals(signals: RoutingSignalBreakdown): number {
  return Object.values(signals).reduce((sum, value) => sum + value, 0)
}

function buildReasons(signals: RoutingSignalBreakdown): string[] {
  const reasons: string[] = []
  if (signals.textLengthScore > 0) reasons.push(`text_length:${signals.textLengthScore}`)
  if (signals.taskCountScore > 0) reasons.push(`task_count:${signals.taskCountScore}`)
  if (signals.dependencyScore > 0) reasons.push(`dependencies:${signals.dependencyScore}`)
  if (signals.stageScore > 0) reasons.push(`stages:${signals.stageScore}`)
  if (signals.keywordScore > 0) reasons.push(`high_risk_keywords:${signals.keywordScore}`)
  if (signals.subsystemScore > 0) reasons.push(`subsystems:${signals.subsystemScore}`)
  if (signals.rolloutScore > 0) reasons.push(`rollout:${signals.rolloutScore}`)
  return reasons
}

function resolveTier(score: number, config: MagpieConfigV2): ComplexityTier {
  const defaultTier = getRoutingConfig(config).default_tier
  const thresholds = getThresholds(config)
  if (score === 0 && defaultTier) {
    return defaultTier
  }
  if (score >= thresholds.complex_min) return 'complex'
  if (score <= thresholds.simple_max) return 'simple'
  return 'standard'
}

function buildDecision(
  config: MagpieConfigV2,
  tier: ComplexityTier,
  score: number,
  reasons: string[],
  signals: RoutingSignalBreakdown,
  escalationTrail: string[] = [],
  fallbackTrail: string[] = []
): RoutingDecision {
  const reviewerPools = getReviewerPools(config)
  const planningBindings = getPlanningBindings(config)
  const executionBindings = getExecutionBindings(config)
  const resolvedPlanning = resolveBinding(config, 'planning', tier, planningBindings[tier])
  const resolvedExecution = resolveBinding(config, 'execution', tier, executionBindings[tier])
  const resolvedReviewers = resolveReviewerIds(config, tier, reviewerPools[tier])

  return {
    schemaVersion: 1,
    tier,
    score,
    reasons,
    signals,
    planning: resolvedPlanning.binding,
    execution: resolvedExecution.binding,
    reviewerIds: resolvedReviewers.reviewerIds,
    escalationTrail,
    fallbackTrail: [
      ...fallbackTrail,
      ...resolvedPlanning.trail,
      ...resolvedExecution.trail,
      ...resolvedReviewers.trail,
    ],
  }
}

export interface CreateRoutingDecisionInput {
  goal: string
  prdContent?: string
  tasks?: LoopTask[]
  relatedPaths?: string[]
  overrideTier?: ComplexityTier
  config: MagpieConfigV2
}

export function isRoutingEnabled(config: MagpieConfigV2): boolean {
  return getRoutingConfig(config).enabled === true
}

export function getRouteBindings(config: MagpieConfigV2, tier: ComplexityTier): Pick<RoutingDecision, 'planning' | 'execution' | 'reviewerIds'> {
  const decision = buildDecision(
    config,
    tier,
    0,
    [],
    {
      textLengthScore: 0,
      taskCountScore: 0,
      dependencyScore: 0,
      stageScore: 0,
      keywordScore: 0,
      subsystemScore: 0,
      rolloutScore: 0,
    }
  )

  return {
    planning: decision.planning,
    execution: decision.execution,
    reviewerIds: decision.reviewerIds,
  }
}

/**
 * Build a routing decision from visible work signals so loop/harness can choose
 * planning, execution, and review providers without hard-coding one provider.
 */
export function createRoutingDecision(input: CreateRoutingDecisionInput): RoutingDecision {
  if (input.overrideTier) {
    return buildDecision(
      input.config,
      input.overrideTier,
      0,
      [`manual_override:${input.overrideTier}`],
      {
        textLengthScore: 0,
        taskCountScore: 0,
        dependencyScore: 0,
        stageScore: 0,
        keywordScore: 0,
        subsystemScore: 0,
        rolloutScore: 0,
      }
    )
  }

  const text = [input.goal, input.prdContent].filter(Boolean).join('\n\n')
  const signals = scoreSignals(text, input.tasks, input.relatedPaths, input.config)
  const score = sumSignals(signals)
  const tier = resolveTier(score, input.config)

  return buildDecision(input.config, tier, score, buildReasons(signals), signals)
}

function nextTier(tier: ComplexityTier): ComplexityTier {
  if (tier === 'simple') return 'standard'
  if (tier === 'standard') return 'complex'
  return 'complex'
}

/**
 * Escalation only moves upward. Once runtime evidence says the work is harder
 * than expected, later stages should not quietly downgrade the route again.
 */
export function escalateRoutingDecision(
  current: RoutingDecision,
  config: MagpieConfigV2,
  reason: string
): RoutingDecision {
  if (getRoutingConfig(config).allow_runtime_escalation === false) {
    return {
      ...current,
      escalationTrail: [...current.escalationTrail],
    }
  }

  const tier = nextTier(current.tier)
  if (tier === current.tier) {
    return {
      ...current,
      escalationTrail: [...current.escalationTrail, reason],
    }
  }

  return buildDecision(
    config,
    tier,
    current.score,
    [...current.reasons],
    { ...current.signals },
    [...current.escalationTrail, reason],
    [...current.fallbackTrail],
  )
}

export interface EscalationSignalInput {
  blockingIssueCount?: number
  testsPassed?: boolean
  modelDecision?: 'approved' | 'revise' | 'unknown'
  consecutiveReviseCount?: number
  providerFailure?: boolean
}

/**
 * Convert concrete runtime outcomes into one coarse escalation reason so logs and
 * persisted decisions stay stable even if the calling capability changes shape.
 */
export function getEscalationReason(input: EscalationSignalInput): string | null {
  if ((input.blockingIssueCount || 0) > 0) return 'high_severity_issue'
  if (input.testsPassed === false) return 'tests_failed'
  if ((input.consecutiveReviseCount || 0) >= 2) return 'repeated_revise'
  if (input.modelDecision === 'revise') return 'model_requested_revise'
  return null
}

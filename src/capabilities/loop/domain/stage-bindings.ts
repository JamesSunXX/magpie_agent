import type { LoopStageBindingsConfig, LoopStageName } from '../../../platform/config/types.js'
import type { RoleBinding } from '../../../core/roles/types.js'

export interface LoopStageBindingRuntimeInput {
  plannerTool?: string
  plannerModel?: string
  plannerAgent?: string
  executorTool?: string
  executorModel?: string
  executorAgent?: string
}

export interface ResolvedLoopStageBinding {
  primary: RoleBinding
  reviewer?: RoleBinding
  rescue?: RoleBinding
}

const DEFAULT_PLANNER_REVIEWER: RoleBinding = { tool: 'gemini-cli', model: 'gemini-cli' }
const DEFAULT_PLANNER_RESCUE: RoleBinding = { tool: 'kiro', model: 'kiro', agent: 'architect' }
const DEFAULT_EXECUTOR_REVIEWER: RoleBinding = { tool: 'gemini-cli', model: 'gemini-cli' }
const DEFAULT_EXECUTOR_RESCUE: RoleBinding = { tool: 'kiro', model: 'kiro', agent: 'dev' }
const PLANNER_STAGE_NAMES = new Set<LoopStageName>([
  'prd_review',
  'domain_partition',
  'trd_generation',
])
const MIDDLE_STAGE_NAMES = new Set<LoopStageName>([
  'dev_preparation',
  'red_test_confirmation',
  'green_fixup',
])
const EXECUTOR_REVIEWER_STAGE_NAMES = new Set<LoopStageName>([
  'implementation',
  'unit_mock_test',
  'integration_test',
])

function cloneBinding(binding: RoleBinding): RoleBinding {
  return {
    ...(binding.tool ? { tool: binding.tool } : {}),
    ...(binding.model ? { model: binding.model } : {}),
    ...(binding.agent ? { agent: binding.agent } : {}),
  }
}

function resolveRuntimeBinding(
  tool?: string,
  model?: string,
  agent?: string
): RoleBinding {
  return {
    ...(tool ? { tool } : {}),
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
  }
}

function createDefaultStageBinding(
  stage: LoopStageName,
  runtime: LoopStageBindingRuntimeInput
): ResolvedLoopStageBinding {
  const planner = resolveRuntimeBinding(runtime.plannerTool, runtime.plannerModel, runtime.plannerAgent)
  const executor = resolveRuntimeBinding(runtime.executorTool, runtime.executorModel, runtime.executorAgent)

  if (PLANNER_STAGE_NAMES.has(stage)) {
    return {
      primary: cloneBinding(planner),
      reviewer: cloneBinding(DEFAULT_PLANNER_REVIEWER),
      rescue: cloneBinding(DEFAULT_PLANNER_RESCUE),
    }
  }

  if (MIDDLE_STAGE_NAMES.has(stage)) {
    return {
      primary: cloneBinding(executor),
      reviewer: cloneBinding(planner),
      rescue: cloneBinding(DEFAULT_EXECUTOR_RESCUE),
    }
  }

  if (EXECUTOR_REVIEWER_STAGE_NAMES.has(stage)) {
    return {
      primary: cloneBinding(executor),
      reviewer: cloneBinding(DEFAULT_EXECUTOR_REVIEWER),
      rescue: cloneBinding(DEFAULT_EXECUTOR_RESCUE),
    }
  }

  throw new Error(`Unhandled loop stage "${stage}" in stage binding resolver`)
}

export function resolveLoopStageBinding(
  stage: LoopStageName,
  runtime: LoopStageBindingRuntimeInput,
  configured: LoopStageBindingsConfig | undefined = undefined
): ResolvedLoopStageBinding {
  const base = createDefaultStageBinding(stage, runtime)
  const override = configured?.[stage]

  return {
    primary: override?.primary ? cloneBinding(override.primary) : base.primary,
    reviewer: override?.reviewer ? cloneBinding(override.reviewer) : base.reviewer,
    rescue: override?.rescue ? cloneBinding(override.rescue) : base.rescue,
  }
}

export function resolveRescueBinding(
  stage: LoopStageName,
  runtime: LoopStageBindingRuntimeInput,
  configured: LoopStageBindingsConfig | undefined = undefined
): RoleBinding | undefined {
  return resolveLoopStageBinding(stage, runtime, configured).rescue
}

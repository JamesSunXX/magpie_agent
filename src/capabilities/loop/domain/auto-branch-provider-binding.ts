import { getProviderForModel, getProviderForTool } from '../../../platform/providers/index.js'
import type { ProviderBindingInput } from '../../../platform/providers/index.js'

export interface AutoBranchProviderBindingInput {
  tool?: string
  model?: string
  agent?: string
}

export function resolveAutoBranchProviderBinding(
  input: AutoBranchProviderBindingInput
): ProviderBindingInput {
  const tool = input.tool?.trim() || undefined
  const model = input.model?.trim() || undefined
  const providerName = tool
    ? getProviderForTool(tool)
    : model
      ? getProviderForModel(model)
      : 'claw'

  return {
    logicalName: 'capabilities.loop.auto_branch',
    ...(tool || !model ? { tool: tool || 'claw' } : {}),
    ...(model ? { model } : {}),
    ...(providerName === 'kiro' ? { agent: input.agent?.trim() || 'dev' } : {}),
  }
}

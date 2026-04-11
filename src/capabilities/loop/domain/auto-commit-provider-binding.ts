import { getProviderForModel, getProviderForTool } from '../../../platform/providers/index.js'
import type { ProviderBindingInput } from '../../../platform/providers/index.js'

export interface AutoCommitProviderBindingInput {
  autoCommitModel?: string
  executorTool?: string
  executorModel: string
  executorAgent?: string
}

function isCliProviderName(providerName: string): boolean {
  return (
    providerName === 'claude-code'
    || providerName === 'codex'
    || providerName === 'claw'
    || providerName === 'gemini-cli'
    || providerName === 'qwen-code'
    || providerName === 'kiro'
  )
}

export function resolveAutoCommitProviderBinding(
  input: AutoCommitProviderBindingInput
): ProviderBindingInput {
  const executorProviderName = input.executorTool
    ? getProviderForTool(input.executorTool)
    : getProviderForModel(input.executorModel)
  const executorAgent = executorProviderName === 'kiro'
    ? input.executorAgent || 'dev'
    : undefined

  if (!input.autoCommitModel) {
    return {
      logicalName: 'capabilities.loop.auto_commit',
      ...(input.executorTool ? { tool: input.executorTool } : {}),
      model: input.executorModel,
      ...(executorAgent ? { agent: executorAgent } : {}),
    }
  }

  const overrideProviderName = getProviderForModel(input.autoCommitModel)

  if (input.executorTool) {
    if (isCliProviderName(overrideProviderName)) {
      return {
        logicalName: 'capabilities.loop.auto_commit',
        tool: overrideProviderName,
        model: input.autoCommitModel,
        ...(overrideProviderName === 'kiro' ? { agent: input.executorAgent || 'dev' } : {}),
      }
    }

    return {
      logicalName: 'capabilities.loop.auto_commit',
      tool: input.executorTool,
      model: input.autoCommitModel,
      ...(executorAgent ? { agent: executorAgent } : {}),
    }
  }

  if (isCliProviderName(overrideProviderName)) {
    return {
      logicalName: 'capabilities.loop.auto_commit',
      model: input.autoCommitModel,
      ...(overrideProviderName === 'kiro' ? { agent: input.executorAgent || 'dev' } : {}),
    }
  }

  if (isCliProviderName(executorProviderName)) {
    return {
      logicalName: 'capabilities.loop.auto_commit',
      tool: executorProviderName,
      model: input.autoCommitModel,
      ...(executorAgent ? { agent: executorAgent } : {}),
    }
  }

  return {
    logicalName: 'capabilities.loop.auto_commit',
    model: input.autoCommitModel,
    ...(overrideProviderName === 'kiro' ? { agent: input.executorAgent || 'dev' } : {}),
  }
}

import type { PlanningContext, PlanningIntegrationConfig } from './types.js'

function normalizeToken(token: string): string {
  return token.trim().replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()
}

export function getDefaultPlanningProjectKey(
  config: PlanningIntegrationConfig | undefined
): string | undefined {
  if (!config?.default_provider) {
    return undefined
  }

  const provider = config.providers?.[config.default_provider]
  return provider?.project_key
}

export function extractPlanningItemKey(
  text: string,
  preferredProjectKey?: string
): string | undefined {
  const normalizedPreferred = preferredProjectKey ? normalizeToken(preferredProjectKey) : ''
  if (normalizedPreferred) {
    const preferredMatch = text.match(new RegExp(`\\b${normalizedPreferred}-\\d+\\b`, 'i'))
    if (preferredMatch) {
      return preferredMatch[0].toUpperCase()
    }
  }

  const genericMatch = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/i)
  return genericMatch ? genericMatch[0].toUpperCase() : undefined
}

export function buildPlanningContextBlock(
  context: PlanningContext | null
): string | undefined {
  if (!context?.summary) {
    return undefined
  }

  const lines = ['Remote planning context:']

  if (context.providerId) {
    lines.push(`Provider: ${context.providerId}`)
  }
  if (context.projectKey) {
    lines.push(`Project: ${context.projectKey}`)
  }
  if (context.itemKey) {
    lines.push(`Item: ${context.itemKey}`)
  }
  if (context.url) {
    lines.push(`URL: ${context.url}`)
  }

  lines.push('', context.summary)
  return lines.join('\n')
}

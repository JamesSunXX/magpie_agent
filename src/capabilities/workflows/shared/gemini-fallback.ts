export interface GeminiCapableBinding {
  tool?: string
  model?: string
}

export function isGeminiBinding(binding: GeminiCapableBinding | undefined): boolean {
  if (!binding) return false
  const tool = binding.tool?.trim().toLowerCase()
  const model = binding.model?.trim().toLowerCase()
  return tool === 'gemini'
    || tool === 'gemini-cli'
    || model === 'gemini-cli'
    || Boolean(model && model.startsWith('gemini'))
}

export function isKnownGeminiModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /modelnotfounderror/i.test(message)
    || /requested entity was not found/i.test(message)
    || /error when talking to gemini api/i.test(message)
    || /code:\s*404/i.test(message)
}

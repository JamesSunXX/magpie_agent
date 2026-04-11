import type { CapabilityContext } from '../../../core/capability/context.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { resolveContextReferences } from '../../../utils/context-references.js'
import type { TrdCapabilityInput, TrdPreparedInput } from '../types.js'

export async function prepareTrdInput(
  input: TrdCapabilityInput,
  ctx: CapabilityContext
): Promise<TrdPreparedInput> {
  const followUp = input.options?.resume && input.prdPath
    ? await resolveContextReferences(input.prdPath, { cwd: ctx.cwd })
    : input.prdPath

  return {
    ...input,
    prdPath: followUp,
    preparedAt: new Date(),
    config: loadConfig(ctx.configPath),
  }
}

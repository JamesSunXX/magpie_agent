import type { CapabilityContext } from '../../../core/capability/context.js'
import { loadConfig } from '../../../platform/config/loader.js'
import type { TrdCapabilityInput, TrdPreparedInput } from '../types.js'

export async function prepareTrdInput(
  input: TrdCapabilityInput,
  ctx: CapabilityContext
): Promise<TrdPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
    config: loadConfig(ctx.configPath),
  }
}

import type { CapabilityContext } from '../../../core/capability/context.js'
import { loadConfigV2 } from '../../../platform/config/loader.js'
import type { DiscussCapabilityInput, DiscussPreparedInput } from '../types.js'

export async function prepareDiscussInput(
  input: DiscussCapabilityInput,
  ctx: CapabilityContext
): Promise<DiscussPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
    config: loadConfigV2(ctx.configPath),
  }
}

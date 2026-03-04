import type { CapabilityContext } from '../../../core/capability/context.js'
import type { DiscussCapabilityInput, DiscussPreparedInput } from '../types.js'

export async function prepareDiscussInput(
  input: DiscussCapabilityInput,
  _ctx: CapabilityContext
): Promise<DiscussPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

import type { CapabilityContext } from '../../../core/capability/context.js'
import type { TrdCapabilityInput, TrdPreparedInput } from '../types.js'

export async function prepareTrdInput(
  input: TrdCapabilityInput,
  _ctx: CapabilityContext
): Promise<TrdPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

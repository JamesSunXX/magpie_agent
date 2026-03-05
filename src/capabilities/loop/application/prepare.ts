import type { CapabilityContext } from '../../../core/capability/context.js'
import type { LoopCapabilityInput, LoopPreparedInput } from '../types.js'

export async function prepareLoopInput(
  input: LoopCapabilityInput,
  _ctx: CapabilityContext
): Promise<LoopPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

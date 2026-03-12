import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { DocsSyncInput, DocsSyncPreparedInput } from '../types.js'

export async function prepareDocsSyncInput(
  input: DocsSyncInput,
  _ctx: CapabilityContext
): Promise<DocsSyncPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

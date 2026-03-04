import type { CapabilityContext } from '../../../core/capability/context.js'
import type { ReviewCapabilityInput, ReviewPreparedInput } from '../types.js'

export async function prepareReviewInput(
  input: ReviewCapabilityInput,
  _ctx: CapabilityContext
): Promise<ReviewPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

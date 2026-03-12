import type { CapabilityContext } from '../../../core/capability/context.js'
import { loadConfigV2 } from '../../../platform/config/loader.js'
import type { ReviewCapabilityInput, ReviewPreparedInput } from '../types.js'

export async function prepareReviewInput(
  input: ReviewCapabilityInput,
  ctx: CapabilityContext
): Promise<ReviewPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
    config: loadConfigV2(ctx.configPath),
  }
}

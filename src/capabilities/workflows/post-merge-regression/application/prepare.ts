import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { PostMergeRegressionInput, PostMergeRegressionPreparedInput } from '../types.js'

export async function preparePostMergeRegressionInput(
  input: PostMergeRegressionInput,
  _ctx: CapabilityContext
): Promise<PostMergeRegressionPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

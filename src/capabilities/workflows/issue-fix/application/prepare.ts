import type { CapabilityContext } from '../../../../core/capability/context.js'
import type { IssueFixInput, IssueFixPreparedInput } from '../types.js'

export async function prepareIssueFixInput(
  input: IssueFixInput,
  _ctx: CapabilityContext
): Promise<IssueFixPreparedInput> {
  return {
    ...input,
    preparedAt: new Date(),
  }
}

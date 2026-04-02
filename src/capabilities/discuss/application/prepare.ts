import type { CapabilityContext } from '../../../core/capability/context.js'
import { loadConfig } from '../../../platform/config/loader.js'
import type { DiscussCapabilityInput, DiscussOptions, DiscussPreparedInput } from '../types.js'

function normalizeDiscussOptions(input: DiscussCapabilityInput): DiscussOptions {
  const source = input.options ?? input

  return {
    rounds: source.rounds ?? '5',
    format: source.format ?? 'markdown',
    reviewers: source.reviewers,
    interactive: source.interactive,
    output: source.output,
    converge: source.converge,
    all: source.all,
    devilAdvocate: source.devilAdvocate,
    list: source.list,
    resume: source.resume,
    config: source.config,
    planReport: source.planReport,
  }
}

export async function prepareDiscussInput(
  input: DiscussCapabilityInput,
  ctx: CapabilityContext
): Promise<DiscussPreparedInput> {
  return {
    ...input,
    options: normalizeDiscussOptions(input),
    preparedAt: new Date(),
    config: loadConfig(ctx.configPath),
  }
}

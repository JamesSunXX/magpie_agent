import { existsSync, readFileSync } from 'fs'
import type { CapabilityContext } from '../../../core/capability/context.js'
import { createRoutingDecision, isRoutingEnabled } from '../../routing/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { resolveContextReferences } from '../../../utils/context-references.js'
import type { DiscussCapabilityInput, DiscussOptions, DiscussPreparedInput } from '../types.js'

function resolveTopicContent(topic: string | undefined): string {
  if (!topic) return ''
  if (existsSync(topic)) {
    return readFileSync(topic, 'utf-8')
  }
  return topic
}

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
    complexity: source.complexity,
  }
}

export async function prepareDiscussInput(
  input: DiscussCapabilityInput,
  ctx: CapabilityContext
): Promise<DiscussPreparedInput> {
  const config = loadConfig(ctx.configPath)
  const options = normalizeDiscussOptions(input)
  const resolvedTopic = await resolveContextReferences(resolveTopicContent(input.topic), {
    cwd: ctx.cwd,
  })
  let routingDecision = undefined

  if (
    isRoutingEnabled(config)
    && !options.reviewers
    && options.all !== true
    && options.list !== true
    && !options.resume
    && !options.export
    && resolvedTopic
  ) {
    routingDecision = createRoutingDecision({
      goal: resolvedTopic,
      overrideTier: options.complexity,
      config,
    })
    options.reviewers = routingDecision.reviewerIds.join(',')
  }

  return {
    ...input,
    topic: resolvedTopic,
    options,
    preparedAt: new Date(),
    config,
    routingDecision,
  }
}

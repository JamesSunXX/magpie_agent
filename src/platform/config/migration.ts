import { logger } from '../../shared/utils/logger.js'
import type { LegacyMagpieConfig, MagpieConfigV2 } from './types.js'

let warnedLegacyFormat = false

function buildDefaultCapabilities(config: LegacyMagpieConfig): MagpieConfigV2['capabilities'] {
  return {
    review: {
      enabled: true,
      max_rounds: config.defaults.max_rounds,
      check_convergence: config.defaults.check_convergence,
      reviewers: Object.keys(config.reviewers),
      skip_context: false,
    },
    discuss: {
      enabled: true,
      max_rounds: config.defaults.max_rounds,
      check_convergence: config.defaults.check_convergence,
      reviewers: Object.keys(config.reviewers),
    },
    trd: config.trd,
    quality: {
      unitTestEval: {
        enabled: true,
        provider: config.analyzer?.model,
        max_files: 50,
        min_coverage: 0.8,
        output_format: config.defaults.output_format,
      },
    },
  }
}

export function migrateConfigToV2(input: LegacyMagpieConfig | MagpieConfigV2): MagpieConfigV2 {
  const maybeV2 = input as Partial<MagpieConfigV2>

  if (maybeV2.capabilities) {
    return {
      providers: maybeV2.providers || {},
      mock: maybeV2.mock,
      defaults: maybeV2.defaults!,
      reviewers: maybeV2.reviewers || {},
      summarizer: maybeV2.summarizer!,
      analyzer: maybeV2.analyzer!,
      contextGatherer: maybeV2.contextGatherer,
      trd: maybeV2.trd,
      capabilities: {
        ...buildDefaultCapabilities(maybeV2 as LegacyMagpieConfig),
        ...maybeV2.capabilities,
      },
    }
  }

  if (!warnedLegacyFormat) {
    logger.warn('Detected legacy config format; auto-migrating to capabilities.* schema in memory.')
    warnedLegacyFormat = true
  }

  return {
    providers: input.providers,
    mock: input.mock,
    defaults: input.defaults,
    reviewers: input.reviewers,
    summarizer: input.summarizer,
    analyzer: input.analyzer,
    contextGatherer: input.contextGatherer,
    trd: input.trd,
    capabilities: buildDefaultCapabilities(input),
  }
}

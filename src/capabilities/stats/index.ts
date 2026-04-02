import type { CapabilityModule } from '../../core/capability/types.js'
import { executeStats } from './application/execute.js'
import { prepareStats } from './application/prepare.js'
import { reportStats } from './application/report.js'
import { summarizeStats } from './application/summarize.js'
import type { StatsInput, StatsPrepared, StatsResult, StatsSummary } from './types.js'

export const statsCapability: CapabilityModule<
  StatsInput,
  StatsPrepared,
  StatsResult,
  StatsSummary
> = {
  name: 'stats',
  prepare: prepareStats,
  execute: executeStats,
  summarize: summarizeStats,
  report: reportStats,
}

import type { CapabilityModule } from '../../core/capability/types.js'
import { executeReview } from './application/execute.js'
import { prepareReviewInput } from './application/prepare.js'
import { reportReviewSummary } from './application/report.js'
import { summarizeReview } from './application/summarize.js'
import type {
  ReviewCapabilityInput,
  ReviewExecutionResult,
  ReviewPreparedInput,
  ReviewSummaryOutput,
} from './types.js'

export const reviewCapability: CapabilityModule<
  ReviewCapabilityInput,
  ReviewPreparedInput,
  ReviewExecutionResult,
  ReviewSummaryOutput
> = {
  name: 'review',
  prepare: prepareReviewInput,
  execute: executeReview,
  summarize: summarizeReview,
  report: reportReviewSummary,
}

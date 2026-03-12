import type { CapabilityModule } from '../../../core/capability/types.js'
import { executePostMergeRegression } from './application/execute.js'
import { preparePostMergeRegressionInput } from './application/prepare.js'
import { reportPostMergeRegression } from './application/report.js'
import { summarizePostMergeRegression } from './application/summarize.js'
import type {
  PostMergeRegressionInput,
  PostMergeRegressionPreparedInput,
  PostMergeRegressionResult,
  PostMergeRegressionSummary,
} from './types.js'

export const postMergeRegressionCapability: CapabilityModule<
  PostMergeRegressionInput,
  PostMergeRegressionPreparedInput,
  PostMergeRegressionResult,
  PostMergeRegressionSummary
> = {
  name: 'post-merge-regression',
  prepare: preparePostMergeRegressionInput,
  execute: executePostMergeRegression,
  summarize: summarizePostMergeRegression,
  report: reportPostMergeRegression,
}

import type { UnitTestEvalConfig } from '../../../platform/config/types.js'

export const DEFAULT_UNIT_TEST_EVAL_CONFIG: Required<UnitTestEvalConfig> = {
  enabled: true,
  provider: 'mock',
  max_files: 50,
  min_coverage: 0.8,
  output_format: 'markdown',
}

import { createCapabilityRegistry } from '../core/capability/registry.js'
import { discussCapability } from './discuss/index.js'
import { docsSyncCapability } from './workflows/docs-sync/index.js'
import { issueFixCapability } from './workflows/issue-fix/index.js'
import { loopCapability } from './loop/index.js'
import { postMergeRegressionCapability } from './workflows/post-merge-regression/index.js'
import { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
import { reviewCapability } from './review/index.js'
import { trdCapability } from './trd/index.js'

export { reviewCapability } from './review/index.js'
export { discussCapability } from './discuss/index.js'
export { trdCapability } from './trd/index.js'
export { issueFixCapability } from './workflows/issue-fix/index.js'
export { docsSyncCapability } from './workflows/docs-sync/index.js'
export { postMergeRegressionCapability } from './workflows/post-merge-regression/index.js'
export { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
export { loopCapability } from './loop/index.js'

export function createDefaultCapabilityRegistry() {
  return createCapabilityRegistry([
    reviewCapability,
    discussCapability,
    trdCapability,
    issueFixCapability,
    docsSyncCapability,
    postMergeRegressionCapability,
    unitTestEvalCapability,
    loopCapability,
  ])
}

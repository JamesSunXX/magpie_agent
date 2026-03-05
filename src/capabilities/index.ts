import { createCapabilityRegistry } from '../core/capability/registry.js'
import { discussCapability } from './discuss/index.js'
import { loopCapability } from './loop/index.js'
import { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
import { reviewCapability } from './review/index.js'
import { trdCapability } from './trd/index.js'

export { reviewCapability } from './review/index.js'
export { discussCapability } from './discuss/index.js'
export { trdCapability } from './trd/index.js'
export { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
export { loopCapability } from './loop/index.js'

export function createDefaultCapabilityRegistry() {
  return createCapabilityRegistry([
    reviewCapability,
    discussCapability,
    trdCapability,
    unitTestEvalCapability,
    loopCapability,
  ])
}

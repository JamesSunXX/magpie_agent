import type { ContextGatherer } from '../context/gatherer.js'
import { DebateOrchestrator } from '../../orchestrator/orchestrator.js'
import type {
  Reviewer,
  DebateResult,
  OrchestratorOptions,
} from '../../orchestrator/types.js'

export interface DebateRunParams {
  reviewers: Reviewer[]
  summarizer: Reviewer
  analyzer: Reviewer
  options: OrchestratorOptions
  label: string
  prompt: string
  contextGatherer?: ContextGatherer
  streaming?: boolean
}

/**
 * Shared debate runner for commands that need adversarial multi-model discussion.
 */
export async function runDebateSession(params: DebateRunParams): Promise<DebateResult> {
  const orchestrator = new DebateOrchestrator(
    params.reviewers,
    params.summarizer,
    params.analyzer,
    params.options,
    params.contextGatherer
  )

  if (params.streaming === false) {
    return orchestrator.run(params.label, params.prompt)
  }

  return orchestrator.runStreaming(params.label, params.prompt)
}

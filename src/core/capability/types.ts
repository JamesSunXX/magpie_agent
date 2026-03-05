import type { CapabilityContext } from './context.js'

export type CapabilityName =
  | 'review'
  | 'discuss'
  | 'trd'
  | 'quality/unit-test-eval'
  | 'loop'

export interface CapabilityModule<TInput, TPrepared, TResult, TOutput> {
  name: CapabilityName
  prepare(input: TInput, ctx: CapabilityContext): Promise<TPrepared>
  execute(prepared: TPrepared, ctx: CapabilityContext): Promise<TResult>
  summarize(result: TResult, ctx: CapabilityContext): Promise<TOutput>
  report(output: TOutput, ctx: CapabilityContext): Promise<void>
}

export type AnyCapabilityModule = CapabilityModule<unknown, unknown, unknown, unknown>

import type { CapabilityContext } from './context.js'
import type { CapabilityModule } from './types.js'

export async function runCapability<TInput, TPrepared, TResult, TOutput>(
  module: CapabilityModule<TInput, TPrepared, TResult, TOutput>,
  input: TInput,
  ctx: CapabilityContext
): Promise<{ prepared: TPrepared; result: TResult; output: TOutput }> {
  const prepared = await module.prepare(input, ctx)
  const result = await module.execute(prepared, ctx)
  const output = await module.summarize(result, ctx)
  await module.report(output, ctx)
  return { prepared, result, output }
}

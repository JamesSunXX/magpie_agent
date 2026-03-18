import type { CapabilityContext } from './context.js'
import type { CapabilityModule } from './types.js'

export async function runCapability<TInput, TPrepared, TResult, TOutput>(
  module: CapabilityModule<TInput, TPrepared, TResult, TOutput>,
  input: TInput,
  ctx: CapabilityContext
): Promise<{ prepared: TPrepared; result: TResult; output: TOutput }> {
  ctx.logger.debug('[runner] starting capability=%s', module.name)
  const prepared = await module.prepare(input, ctx)
  ctx.logger.debug('[runner] prepare done, executing...')
  const result = await module.execute(prepared, ctx)
  ctx.logger.debug('[runner] execute done, summarizing...')
  const output = await module.summarize(result, ctx)
  await module.report(output, ctx)
  ctx.logger.debug('[runner] capability=%s finished', module.name)
  return { prepared, result, output }
}

import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { getHarnessProgressObserver } from '../../../src/capabilities/workflows/harness/progress.js'

describe('harness progress observer', () => {
  it('returns undefined when harness progress metadata is missing', () => {
    const ctx = createCapabilityContext({ cwd: '/tmp/project' })

    expect(getHarnessProgressObserver(ctx)).toBeUndefined()
  })

  it('returns undefined when harness progress metadata has no callbacks', () => {
    const ctx = createCapabilityContext({
      cwd: '/tmp/project',
      metadata: {
        harnessProgress: {},
      },
    })

    expect(getHarnessProgressObserver(ctx)).toBeUndefined()
  })

  it('returns the observer when at least one callback is provided', () => {
    const onEvent = vi.fn()
    const ctx = createCapabilityContext({
      cwd: '/tmp/project',
      metadata: {
        harnessProgress: {
          onEvent,
        },
      },
    })

    expect(getHarnessProgressObserver(ctx)).toEqual({
      onEvent,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { verifyFeishuChallenge } from '../../../src/platform/integrations/im/feishu/signature.js'

describe('verifyFeishuChallenge', () => {
  it('accepts a valid verification token challenge request', () => {
    const result = verifyFeishuChallenge({
      token: 'demo-token',
      challenge: 'challenge-123',
    }, {
      verificationToken: 'demo-token',
    })

    expect(result.accepted).toBe(true)
    expect(result.challenge).toBe('challenge-123')
  })

  it('rejects challenge requests with a mismatched token', () => {
    const result = verifyFeishuChallenge({
      token: 'wrong-token',
      challenge: 'challenge-123',
    }, {
      verificationToken: 'demo-token',
    })

    expect(result).toEqual({ accepted: false })
  })
})

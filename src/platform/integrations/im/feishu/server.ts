import { createServer, type Server } from 'http'
import { parseFeishuEvent } from './events.js'
import { verifyFeishuChallenge } from './signature.js'
import type { ImInboundEvent } from '../types.js'

export function createFeishuCallbackServer(options: {
  path: string
  verificationToken: string
  onEvent: (event: ImInboundEvent) => Promise<void>
}): Server {
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== options.path) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { token?: string; challenge?: string }
      const challenge = verifyFeishuChallenge(payload, {
        verificationToken: options.verificationToken,
      })

      if (challenge.accepted) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ challenge: challenge.challenge }))
        return
      }

      await options.onEvent(parseFeishuEvent(payload))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (error) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  })
}

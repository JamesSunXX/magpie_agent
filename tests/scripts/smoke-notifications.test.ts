import { describe, expect, it } from 'vitest'
import {
  buildSmokeNotificationConfig,
  buildSmokeNotificationEvent,
} from '../../scripts/smoke-notifications.ts'

describe('smoke-notifications script', () => {
  it('uses interactive cards for the feishu smoke provider', () => {
    const config = buildSmokeNotificationConfig('loop_completed', {
      bluebubblesServerUrl: 'https://bluebubbles.example.com',
      bluebubblesPassword: 'secret',
      bluebubblesChatGuid: 'iMessage;-;+8613800138000',
      feishuWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
      feishuWebhookSecret: 'signing-secret',
    })

    expect(config.providers.feishu_smoke.msg_type).toBe('interactive')
  })

  it('builds a structured smoke event body for card rendering', () => {
    const event = buildSmokeNotificationEvent('loop_completed', 'smoke-123')

    expect(event.message).toContain('任务: Smoke notification from magpie')
    expect(event.message).toContain('事件: loop_completed')
    expect(event.message).toContain('目标: bluebubbles_smoke, feishu_smoke')
    expect(event.message).toContain('会话: smoke-123')
    expect(event.message).not.toContain('通道: feishu_smoke')
  })
})

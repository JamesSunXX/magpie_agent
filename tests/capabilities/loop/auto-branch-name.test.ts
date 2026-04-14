import { describe, expect, it, vi } from 'vitest'
import { generateAutoBranchName } from '../../../src/capabilities/loop/domain/auto-branch-name.js'

describe('generateAutoBranchName', () => {
  it('uses the AI slug and appends a timestamp suffix', async () => {
    const provider = {
      name: 'mock-branch-namer',
      chat: vi.fn().mockResolvedValue('分支名：admin-cancel-audit-sync'),
      chatStream: vi.fn(async function * () {}),
    }

    await expect(generateAutoBranchName({
      prefix: 'sch/',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath: '/repo/docs/current/admin_backend/PRD.md',
      provider,
      now: new Date('2026-04-13T05:47:26.000Z'),
    })).resolves.toEqual({
      branchName: 'sch/admin-cancel-audit-sync-2026-04-13-05-47-26',
      slug: 'admin-cancel-audit-sync',
      source: 'ai',
    })
  })

  it('falls back to the PRD path when the AI output is not usable', async () => {
    const provider = {
      name: 'mock-branch-namer',
      chat: vi.fn().mockResolvedValue('这里是一个解释，不是分支名。'),
      chatStream: vi.fn(async function * () {}),
    }

    await expect(generateAutoBranchName({
      prefix: 'sch/',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath: '/repo/docs/current/admin_backend/PRD.md',
      provider,
      now: new Date('2026-04-13T05:47:26.000Z'),
    })).resolves.toEqual({
      branchName: 'sch/admin-backend-2026-04-13-05-47-26',
      slug: 'admin-backend',
      source: 'fallback',
      reason: 'invalid_slug',
    })
  })

  it('returns the legacy timestamp-only branch name when semantic fallback is disabled', async () => {
    await expect(generateAutoBranchName({
      prefix: 'sch/',
      goal: '补齐管理后台接口、控制面能力和数据面支撑',
      prdPath: '/repo/docs/current/admin_backend/PRD.md',
      allowSemanticFallback: false,
      now: new Date('2026-04-13T05:47:26.000Z'),
    })).resolves.toEqual({
      branchName: 'sch/2026-04-13-05-47-26',
      slug: '',
      source: 'fallback',
    })
  })
})

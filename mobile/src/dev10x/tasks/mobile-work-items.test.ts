import { describe, expect, it } from 'vitest'

import { fetchDev10xWorkItems } from './mobile-work-items'

describe('fetchDev10xWorkItems', () => {
  it('reads native Symphony issues without relabeling them as an upstream provider', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const client = {
      async sendRequest(method: string, params: unknown) {
        calls.push({ method, params })
        return {
          ok: true as const,
          result: {
            provider: 'symphony',
            totalCount: 1,
            items: [
              {
                id: '101',
                identifier: 'DEV-101',
                title: 'Dev10x mobile',
                projectSlug: 'dev10x',
                projectName: 'Dev10x',
                status: 'In Progress',
                updatedAt: '2026-07-25T21:00:00Z',
                agent: 'codex',
                agentState: 'live',
                blockedBy: ['DEV-99'],
                subtaskCount: 2,
                pendingApproval: true,
                pendingQuestion: false
              }
            ]
          }
        }
      }
    }

    await expect(fetchDev10xWorkItems(client, { query: 'mobile' })).resolves.toEqual({
      totalCount: 1,
      items: [
        expect.objectContaining({
          identifier: 'DEV-101',
          projectSlug: 'dev10x',
          agent: 'codex',
          blockedBy: ['DEV-99'],
          pendingApproval: true
        })
      ]
    })
    expect(calls).toEqual([
      {
        method: 'symphony.tasks.list',
        params: { query: 'mobile' }
      }
    ])
  })

  it('normalizes transport errors and rejects non-Symphony envelopes', async () => {
    const failed = {
      async sendRequest() {
        return {
          ok: false as const,
          error: { code: 'offline', message: 'Selected host is offline' }
        }
      }
    }
    await expect(fetchDev10xWorkItems(failed, {})).rejects.toThrow('Selected host is offline')

    const fabricated = {
      async sendRequest() {
        return {
          ok: true as const,
          result: { provider: 'github', totalCount: 0, items: [] }
        }
      }
    }
    await expect(fetchDev10xWorkItems(fabricated, {})).rejects.toThrow(
      'Unexpected Symphony task response'
    )
  })
})

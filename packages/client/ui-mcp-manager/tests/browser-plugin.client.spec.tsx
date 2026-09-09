import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { McpServerSnapshot } from '@deepseek-ai/dsh-mcp-manager/types'
import { apply, inject } from '../src/client/index.ts'
import { McpManagerSettingsTab, type McpManagerSettingsTabInjected } from '../src/client/McpManagerSettingsTab.tsx'

const SNAPSHOT: McpServerSnapshot = { revision: 1, servers: [] }

/** Mounts the client plugin with one generated Remote namespace stand-in. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const list = vi.fn<() => Promise<RemoteResult<McpServerSnapshot>>>()
    .mockResolvedValue({ ok: true, value: SNAPSHOT })
  const manager = {
    list,
    create: vi.fn(),
    update: vi.fn(),
    deleteServer: vi.fn(),
    setEnabled: vi.fn(),
    reconnect: vi.fn(),
    probe: vi.fn(),
  }
  class RemoteService extends Service {
    readonly mcpManager = manager

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.mcpManager', manager)
  return { ctx, list, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-mcp-manager browser plugin', () => {
  it('declares the settings, Remote, and locale services it reads', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.mcpManager', 'locale'])
  })

  it('registers the tab and unwraps generated Remote results', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(McpManagerSettingsTab)
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP 管理')
    const injected = (entry.inject as unknown as () => McpManagerSettingsTabInjected)()
    await expect(injected.manager.list()).resolves.toEqual(SNAPSHOT)
    expect(b.list).toHaveBeenCalledOnce()

    b.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'unavailable', {}) })
    await expect(injected.manager.list()).rejects.toThrow('mcpManager.list failed: gateway/internal: unavailable')
    await b.ctx.fiber.dispose()
  })
})

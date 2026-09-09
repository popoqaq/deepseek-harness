import { fileURLToPath } from 'node:url'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CredentialProvider, type CredentialInfo, type CredentialKey, type CredentialRecord, type CredentialRecordEntry, type CredentialRecordInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as McpClient from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import McpManagerService, { MCP_SERVERS_NAMESPACE } from '@deepseek-ai/dsh-mcp-manager/src/index.ts'
import type { McpServerDraft, McpServerSnapshot } from '@deepseek-ai/dsh-mcp-manager/src/types.ts'

class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

class MemoryCredentials extends CredentialProvider {
  private readonly values = new Map<string, string>()
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }
  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.values.has(ref), writable: true, source: 'memory' })
  }
  set(ref: CredentialRef, value: string): Promise<void> { this.values.set(ref, value); return Promise.resolve() }
  unset(ref: CredentialRef): Promise<void> { this.values.delete(ref); return Promise.resolve() }

  // Record storage is not exercised by these lifecycle tests; the minimal
  // surfaces keep the provider constructible against the current contract.
  private readonly records = new Map<CredentialKey, CredentialRecord>()
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }
  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }
  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(key))
    if (next !== undefined) this.records.set(key, next)
    return next
  }
  override deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
    return Promise.resolve()
  }
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const packageDirectory = fileURLToPath(new URL('../../mcp-client/', import.meta.url))

function fixtureDraft(enabled = true): McpServerDraft {
  return {
    serverName: 'managed-fixture', transport: 'stdio', enabled, command: process.execPath,
    args: [fixtureServerPath], cwd: packageDirectory, env: {}, credentialEnv: {}, credentialHeaders: {},
    toolCallTimeoutMs: 15_000, failOnStartupError: true,
    reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 100, maxAttempts: 1 },
  }
}

async function mountManager(): Promise<{ ctx: Context; manager: McpManagerService }> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(Loader)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-mcp-client') return McpClient
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(McpManagerService, { probeTimeoutMs: 15_000 })
  return { ctx, manager: ctx.get('mcpManager') as McpManagerService }
}

describe('MCP manager real Loader composition', () => {
  it('creates, exposes, disables, and removes a managed MCP client', async () => {
    const { ctx, manager } = await mountManager()
    const created = await manager.create({ config: fixtureDraft() })
    expect(created.servers).toHaveLength(1)
    expect(created.servers[0]?.config.env).toEqual({})
    expect(ctx.tools.get('mcp__managed-fixture__greet')).toBeDefined()
    const beforeLateEvent = await manager.list()
    ctx.emit('mcp-client/status', {
      managedEntryId: 'mcp-managed-server-stale:generation', serverName: 'managed-fixture',
      state: 'failed', toolCount: 0, error: 'stale',
    })
    expect((await manager.list()).servers[0]?.state).toBe(beforeLateEvent.servers[0]?.state)

    const disabled = await manager.setEnabled({ id: created.servers[0]!.config.id, enabled: false, expectedRevision: created.revision })
    expect(disabled.servers[0]?.state).toBe('disabled')
    expect(ctx.tools.get('mcp__managed-fixture__greet')).toBeUndefined()

    const removed = await manager.remove({ id: created.servers[0]!.config.id, expectedRevision: disabled.revision })
    expect(removed.servers).toHaveLength(0)
    expect(ctx.loader.resolve).toBeTypeOf('function')
    expect(() => ctx.loader.resolve(`mcp-managed-${created.servers[0]!.config.id}`)).toThrow()
  }, 30_000)

  it('reconnects one MCP by replacing only its Loader entry', async () => {
    const { ctx, manager } = await mountManager()
    const created = await manager.create({ config: fixtureDraft() })
    const entryId = `mcp-managed-${created.servers[0]!.config.id}`
    const remove = vi.spyOn(ctx.loader, 'remove')
    const update = vi.spyOn(ctx.loader, 'update')

    await manager.reconnect({ id: created.servers[0]!.config.id, expectedRevision: created.revision })

    expect(remove).toHaveBeenCalledWith(entryId)
    expect(update).not.toHaveBeenCalled()
  }, 30_000)

  it('returns a blocked state for an unresolved credential without starting a child', async () => {
    const { manager } = await mountManager()
    const draft = { ...fixtureDraft(), serverName: 'blocked-fixture', credentialEnv: { TOKEN: 'MISSING_TOKEN' } }
    const result: McpServerSnapshot = await manager.create({ config: draft })
    expect(result.servers[0]?.state).toBe('blocked')
    expect(result.servers[0]?.error).toContain('MISSING_TOKEN')
  })

  it('rejects stale reconnect revisions', async () => {
    const { manager } = await mountManager()
    const created = await manager.create({ config: { ...fixtureDraft(false), serverName: 'revision-fixture' } })
    const stale = { id: created.servers[0]!.config.id, expectedRevision: created.revision - 1 }
    await expect(manager.reconnect(stale)).rejects.toThrow(/settings changed from revision/)
    expect(MCP_SERVERS_NAMESPACE).toBe('mcp-servers')
  })
})

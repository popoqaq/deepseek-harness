/** Persisted, Web-manageable MCP Server lifecycle and Remote surface. */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, type SettingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { probeMcpServer, type McpClientStatus } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  ManagerConfigSchema,
  serversSettingsSchema,
  validateServers,
} from './schema.ts'
import { MCP_REDACTED_VALUE } from './types.ts'
import type {
  McpCreateRequest,
  McpCredentialView,
  McpManagerErrorCode,
  McpProbeRequest,
  McpProbeResult,
  McpReconnectRequest,
  McpRemoveRequest,
  McpServerDraft,
  McpServerId,
  McpServerPatch,
  McpServerRecord,
  McpServerSnapshot,
  McpServerState,
  McpServerView,
  McpServerViewConfig,
  McpServersSettings,
  McpSetEnabledRequest,
  McpUpdateRequest,
} from './types.ts'

// Type-only imports install Context declaration merges without pulling their
// implementations into the client-safe Remote contract.
import type {} from '@deepseek-ai/dsh-mcp-client'

export * from './types.ts'
export { serversSettingsSchema, serverSchema } from './schema.ts'

/** Settings namespace owned by the manager. */
export const MCP_SERVERS_NAMESPACE: SettingsNamespace = 'mcp-servers' as SettingsNamespace

/** Module loaded for each enabled managed server. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Prefix reserved for in-memory Loader entries created by this service. */
const MANAGED_ENTRY_PREFIX = 'mcp-managed-'

/** One runtime status record, deliberately separate from persisted config. */
interface RuntimeStatus {
  state: McpServerState
  toolCount: number
  error?: string
  updatedAt: number
}

/** Error with a stable manager-facing code. */
export class McpManagerError extends Error {
  /** Machine-readable failure category. */
  readonly code: McpManagerErrorCode

  /** @param code - stable failure category; @param message - correction-oriented message. */
  constructor(code: McpManagerErrorCode, message: string) {
    super(message)
    this.name = 'McpManagerError'
    this.code = code
  }
}

/** A missing credential blocks one desired runtime without failing the Host. */
class MissingCredentialError extends McpManagerError {
  /** @param ref - missing credential reference. */
  constructor(readonly ref: string) {
    super('MCP_CREDENTIAL_MISSING', `credential "${ref}" is not configured`)
  }
}

/** Persisted MCP manager and dynamic Loader orchestrator. */
export class McpManagerService extends TypertRemoteService {
  static inject = ['loader', 'settings', 'credentials', 'tools']
  static Config: z<{ probeTimeoutMs: number }> = ManagerConfigSchema as z<{ probeTimeoutMs: number }>

  private readonly settingsScope: SettingsScope<McpServersSettings>
  private readonly probeTimeoutMs: number
  private readonly statuses = new Map<string, RuntimeStatus>()
  private readonly fingerprints = new Map<string, string>()
  private readonly generations = new Map<string, string>()
  private readonly ownedEntryIds = new Set<string>()
  private readonly observedConfigIds = new Set<string>()
  private readonly secretValues = new Set<string>()
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * Register the manager service and its persisted desired-state namespace.
   * @param ctx - Host context containing Loader, settings, and credentials.
   * @param config - manager-level probe deadline.
   */
  constructor(ctx: Context, config: { probeTimeoutMs: number }) {
    super(ctx, 'mcpManager')
    this.probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    this.settingsScope = ctx.settings.register('mcp-servers', serversSettingsSchema, {
      base: { servers: [] },
      validate: validateServers,
    })

    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'mcp_install',
      description: 'Install one MCP server for the current Agent. MCP installation is Agent-only; do not ask the user to edit MCP JSON. '
        + 'Pass a JSON object containing serverName, transport, and stdio command/args/cwd or Streamable HTTP url. '
        + 'Use credentialEnv/credentialHeaders references for auth. If an API key or Authorization header is needed, install the server first and ask the user to configure its auth fields in Settings.',
      parameters: {
        config: {
          type: 'string',
          required: true,
          description: 'JSON MCP server draft. Include serverName, transport, enabled, env, credentialEnv, and reconnect; use empty env/headers for unauthenticated servers.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            serverName: { type: 'string', required: true },
            state: { type: 'string', required: true },
            toolCount: { type: 'integer', required: true },
            revision: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `MCP ${value.serverName} installed; state=${value.state}, tools=${String(value.toolCount)}` }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('mcp_install requires a calling Agent')
        let config: unknown
        try { config = JSON.parse(args.config) } catch { throw new McpManagerError('MCP_INVALID_CONFIG', 'mcp_install.config must be valid JSON') }
        if (typeof config !== 'object' || config === null || Array.isArray(config)) {
          throw new McpManagerError('MCP_INVALID_CONFIG', 'mcp_install.config must be a JSON object')
        }
        rejectAgentAuthLiterals(config as Record<string, unknown>)
        const snapshot = await this.create({ config: config as McpServerDraft })
        const server = snapshot.servers.find(
          item => item.config.serverName === (config as { serverName?: unknown }).serverName,
        )
        if (server === undefined) {
          throw new McpManagerError('MCP_INVALID_CONFIG', 'installed server was not present in the resulting snapshot')
        }
        return {
          id: server.config.id,
          serverName: server.config.serverName,
          state: server.state,
          toolCount: server.toolCount,
          revision: snapshot.revision,
        }
      },
    })), 'mcp-manager Agent installer')

    ctx.effect(() => {
      const offSettings = this.settingsScope.watch((next) => {
        const previousIds = new Set(this.observedConfigIds)
        this.observedConfigIds.clear()
        for (const server of next.servers) this.observedConfigIds.add(server.id)
        void this.enqueue(async () => {
          await this.reconcile(next.servers)
          const changedIds = new Set([...previousIds, ...this.observedConfigIds])
          for (const id of changedIds) {
            const server = next.servers.find(candidate => candidate.id === id)
            const state = server === undefined
              ? 'stopped'
              : this.statuses.get(id)?.state ?? (server.enabled ? 'stopped' : 'disabled')
            this.changed(id, state)
          }
        })
      })
      const offStatus = ctx.on('mcp-client/status', (status) => { this.onClientStatus(status) })
      const offCredentials = ctx.on('credentials/reference-updated', (ref) => {
        if (this.referencesCredential(ref)) void this.enqueue(() => this.reconcile(this.settingsScope.get().servers))
      })
      return async () => {
        this.disposed = true
        offSettings()
        offStatus()
        offCredentials()
        await this.operationTail
        for (const entryId of [...this.ownedEntryIds]) await this.removeEntryId(entryId)
        this.ownedEntryIds.clear()
        this.fingerprints.clear()
        this.generations.clear()
        this.statuses.clear()
      }
    }, 'mcp-manager observers')
  }

  /** Reconcile persisted desired state before the service becomes active. */
  protected async [Service.init](): Promise<void> {
    await this.enqueue(() => this.reconcile(this.settingsScope.get().servers))
  }

  /** Return the current managed server list without exposing secret values. */
  @Remote('list')
  async list(): Promise<McpServerSnapshot> {
    return this.snapshot()
  }

  /** Add one server and reconcile its runtime projection. */
  @Remote('create')
  async create(request: McpCreateRequest): Promise<McpServerSnapshot> {
    return this.mutateSettings(request.expectedRevision, (current) => {
      const id = mintServerId(current.servers)
      const record = normalizeDraft(request.config, id)
      return [...current.servers, record]
    })
  }

  /** Update one server using the caller's settings revision fence. */
  @Remote('update')
  async update(request: McpUpdateRequest): Promise<McpServerSnapshot> {
    return this.mutateSettings(request.expectedRevision, (current) => {
      const index = current.servers.findIndex(server => server.id === request.id)
      if (index < 0) throw new McpManagerError('MCP_SERVER_NOT_FOUND', `MCP server "${request.id}" was not found`)
      const next = [...current.servers]
      const existing = next[index]
      if (existing === undefined) throw new McpManagerError('MCP_SERVER_NOT_FOUND', `MCP server "${request.id}" was not found`)
      next[index] = normalizeDraft(applyPatch(existing, request.patch), request.id)
      return next
    })
  }

  /** Remove one server and wait for its dynamic child to disappear. */
  @Remote('deleteServer')
  async remove(request: McpRemoveRequest): Promise<McpServerSnapshot> {
    return this.mutateSettings(request.expectedRevision, (current) => {
      if (!current.servers.some(server => server.id === request.id)) {
        throw new McpManagerError('MCP_SERVER_NOT_FOUND', `MCP server "${request.id}" was not found`)
      }
      return current.servers.filter(server => server.id !== request.id)
    })
  }

  /** Toggle whether a persisted Server has a live Loader child. */
  @Remote('setEnabled')
  async setEnabled(request: McpSetEnabledRequest): Promise<McpServerSnapshot> {
    return this.mutateSettings(request.expectedRevision, (current) => {
      const existing = current.servers.find(server => server.id === request.id)
      if (existing === undefined) {
        throw new McpManagerError('MCP_SERVER_NOT_FOUND', `MCP server "${request.id}" was not found`)
      }
      if (existing.enabled === request.enabled) return current.servers
      return current.servers.map(server => server.id === request.id ? { ...server, enabled: request.enabled } : server)
    })
  }

  /** Force one enabled child to be rebuilt without touching sibling MCP entries. */
  @Remote('reconnect')
  async reconnect(request: McpReconnectRequest): Promise<McpServerSnapshot> {
    return this.enqueue(async () => {
      const revision = this.settingsRevision()
      if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
        throw new McpManagerError('MCP_CONFIG_CONFLICT', `MCP settings changed from revision ${String(request.expectedRevision)} to ${String(revision)}`)
      }
      const server = this.settingsScope.get().servers.find(candidate => candidate.id === request.id)
      if (server === undefined) throw new McpManagerError('MCP_SERVER_NOT_FOUND', `MCP server "${request.id}" was not found`)
      const entryId = entryIdOf(server.id)
      await this.removeEntryId(entryId)
      this.fingerprints.delete(server.id)
      this.generations.delete(server.id)
      this.statuses.delete(server.id)
      await this.reconcileServer(server)
      return this.snapshot()
    })
  }

  /** Probe a draft without persisting it or registering its tools. */
  @Remote('probe')
  async probe(request: McpProbeRequest): Promise<McpProbeResult> {
    try {
      const record = normalizeDraft(request.config, 'probe' as McpServerId)
      const config = await this.runtimeConfig(record, 'mcp-probe')
      const result = await probeMcpServer(config, this.probeTimeoutMs)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, code: error instanceof McpManagerError ? error.code : 'MCP_PROBE_FAILED', message: this.safeMessage(error) }
    }
  }

  private async mutateSettings(
    expectedRevision: number | undefined,
    change: (current: McpServersSettings) => McpServerRecord[],
  ): Promise<McpServerSnapshot> {
    return this.enqueue(async () => {
      const current = this.settingsScope.get()
      const revision = this.settingsRevision()
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new McpManagerError('MCP_CONFIG_CONFLICT', `MCP settings changed from revision ${String(expectedRevision)} to ${String(revision)}`)
      }
      const servers = change({ servers: structuredClone(current.servers) })
      validateServers({ servers })
      try {
        await this.ctx.settings.update(MCP_SERVERS_NAMESPACE, { servers }, revision)
      } catch (error) {
        if (error instanceof SettingsConflictError) throw new McpManagerError('MCP_CONFIG_CONFLICT', error.message)
        throw error
      }
      await this.reconcile(servers)
      return this.snapshot()
    })
  }

  private settingsRevision(): number {
    const descriptor = this.ctx.settings.describe().find(candidate => candidate.ns === MCP_SERVERS_NAMESPACE)
    return descriptor?.revision ?? 0
  }

  private async enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const task = this.operationTail.then(operation)
    this.operationTail = task.then(() => undefined, () => undefined)
    return task
  }

  private async reconcile(records: readonly McpServerRecord[]): Promise<void> {
    if (this.disposed) return
    const desired = new Set<string>(records.filter(server => server.enabled).map(server => server.id))
    for (const entryId of [...this.ownedEntryIds]) {
      const id = entryId.slice(MANAGED_ENTRY_PREFIX.length)
      if (!desired.has(id)) {
        await this.removeEntryId(entryId)
        this.fingerprints.delete(id)
        this.generations.delete(id)
        this.statuses.delete(id)
        this.changed(id, 'stopped')
      }
    }

    for (const server of records) await this.reconcileServer(server)
  }

  /** Reconcile one server without evaluating or mutating sibling entries. */
  private async reconcileServer(server: McpServerRecord): Promise<void> {
    const entryId = entryIdOf(server.id)
    if (!server.enabled) {
      await this.removeEntryId(entryId)
      this.fingerprints.delete(server.id)
      this.generations.delete(server.id)
      this.setStatus(server.id, { state: 'disabled', toolCount: 0 })
      return
    }
    try {
      const baseConfig = await this.runtimeConfig(server, entryId)
      const fingerprint = runtimeFingerprint(baseConfig)
      const entryPresent = this.hasEntry(entryId)
      if (this.fingerprints.get(server.id) !== fingerprint || !this.ownedEntryIds.has(entryId) || !entryPresent) {
        this.setStatus(server.id, { state: 'connecting', toolCount: 0 })
        const generation = `${entryId}:${randomUUID()}`
        const config = await this.runtimeConfig(server, generation)
        this.generations.set(server.id, generation)
        if (entryPresent) {
          await this.ctx.loader.update(entryId, { config } as never)
        } else {
          await this.ctx.loader.create({ id: entryId, name: MCP_CLIENT_MODULE, config } as never)
        }
        this.ownedEntryIds.add(entryId)
        this.fingerprints.set(server.id, fingerprint)
      }
    } catch (error) {
      await this.removeEntryId(entryId)
      this.fingerprints.delete(server.id)
      this.generations.delete(server.id)
      const state: McpServerState = error instanceof MissingCredentialError ? 'blocked' : 'failed'
      this.setStatus(server.id, { state, toolCount: 0, error: this.safeMessage(error) })
    }
  }

  private async runtimeConfig(server: McpServerRecord, managedEntryId: string): Promise<McpClientConfig> {
    const env = { ...(server.env ?? {}) }
    for (const value of Object.values(env)) if (value.length > 0) this.secretValues.add(value)
    for (const [name, ref] of Object.entries(server.credentialEnv ?? {})) env[name] = await this.resolveCredential(ref)
    for (const value of Object.values(env)) if (value.length > 0) this.secretValues.add(value)
    const base = {
      serverName: server.serverName,
      managedEntryId,
      toolCallTimeoutMs: server.toolCallTimeoutMs,
      failOnStartupError: server.failOnStartupError,
      reconnect: server.reconnect,
    }
    if (server.transport === 'stdio') {
      return {
        ...base,
        transport: 'stdio',
        command: server.command ?? '',
        args: server.args ?? [],
        cwd: server.cwd ?? '',
        env,
      }
    }
    const headers = { ...(server.headers ?? {}) }
    for (const value of Object.values(headers)) if (value.length > 0) this.secretValues.add(value)
    for (const [name, ref] of Object.entries(server.credentialHeaders ?? {})) headers[name] = await this.resolveCredential(ref)
    for (const value of Object.values(headers)) if (value.length > 0) this.secretValues.add(value)
    return { ...base, transport: 'streamable-http', url: server.url ?? '', headers }
  }

  private async resolveCredential(ref: string): Promise<string> {
    const value = await (this.ctx.credentials as CredentialProvider).resolve(credentialRef(ref))
    if (value === undefined || value.value.length === 0) throw new MissingCredentialError(ref)
    return value.value
  }

  private referencesCredential(ref: string): boolean {
    return this.settingsScope.get().servers.some(server =>
      Object.values(server.credentialEnv ?? {}).includes(ref)
      || Object.values(server.credentialHeaders ?? {}).includes(ref))
  }

  private hasEntry(id: string): boolean {
    try {
      this.ctx.loader.resolve(id)
      return true
    } catch {
      return false
    }
  }

  /** Remove one Loader entry owned by this manager. */
  private async removeEntryId(entryId: string): Promise<void> {
    if (!this.ownedEntryIds.has(entryId) && !this.hasEntry(entryId)) return
    try {
      await this.ctx.loader.remove(entryId)
      this.ownedEntryIds.delete(entryId)
    } catch (error) {
      if (!this.hasEntry(entryId)) {
        this.ownedEntryIds.delete(entryId)
        return
      }
      throw error
    }
  }

  private onClientStatus(status: McpClientStatus): void {
    const server = this.settingsScope.get().servers.find(candidate =>
      status.managedEntryId !== undefined
        ? this.generations.get(candidate.id) === status.managedEntryId
        : this.generations.has(candidate.id) && candidate.serverName === status.serverName)
    if (server === undefined) return
    this.setStatus(server.id, {
      state: status.state,
      toolCount: status.toolCount,
      ...status.error === undefined ? {} : { error: this.safeMessage(status.error) },
    })
  }

  private setStatus(id: McpServerId, next: Omit<RuntimeStatus, 'updatedAt'>): void {
    const status = { ...next, updatedAt: Date.now() }
    this.statuses.set(id, status)
    this.changed(id, status.state)
  }

  private changed(id: McpServerId | string, state: McpServerState): void {
    if (!this.disposed) this.ctx.emit('mcp-manager/changed', id as McpServerId, state)
  }

  private safeMessage(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error)
    for (const secret of this.secretValues) {
      if (secret.length > 0) message = message.replaceAll(secret, '[redacted]')
    }
    return safeMessage(message)
  }

  private async snapshot(): Promise<McpServerSnapshot> {
    const revision = this.settingsRevision()
    const servers = await Promise.all(this.settingsScope.get().servers.map(async (config) => {
      const runtime = this.statuses.get(config.id) ?? {
        state: config.enabled ? 'stopped' as const : 'disabled' as const,
        toolCount: 0,
        updatedAt: 0,
      }
      return {
        config: projectServerConfig(config),
        state: runtime.state,
        toolCount: runtime.toolCount,
        ...runtime.error === undefined ? {} : { error: runtime.error },
        ...runtime.updatedAt === 0 ? {} : { updatedAt: runtime.updatedAt },
        credentials: await this.credentialViews(config),
      } satisfies McpServerView
    }))
    return { revision, servers }
  }

  private async credentialViews(config: McpServerRecord): Promise<McpCredentialView[]> {
    const refs = new Set([...Object.values(config.credentialEnv ?? {}), ...Object.values(config.credentialHeaders ?? {})])
    return Promise.all([...refs].map(async (ref) => {
      const info = await (this.ctx.credentials as CredentialProvider).describe(credentialRef(ref))
      return { ref, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
    }))
  }
}

/** Default service export required by Loader service-package convention. */
export default McpManagerService

/** Excludes each child instance's generation identity from its desired-state fingerprint. */
function runtimeFingerprint(config: McpClientConfig): string {
  const { managedEntryId: _managedEntryId, ...stableConfig } = config
  return JSON.stringify(stableConfig)
}

export function projectServerConfig(config: McpServerRecord): McpServerViewConfig {
  if (config.transport === 'stdio') return { ...config, env: valueMapView(config.env) }
  return { ...config, env: valueMapView(config.env), headers: valueMapView(config.headers) }
}

function valueMapView(values: Record<string, string>): Record<string, { configured: boolean }> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { configured: value.length > 0 }]))
}

function applyPatch(current: McpServerRecord, patch: McpServerPatch): McpServerDraft {
  const next = { ...current, ...patch } as McpServerRecord
  if (patch.env !== undefined) next.env = preserveMaskedMap(current.env, patch.env)
  if (next.transport === 'streamable-http' && patch.headers !== undefined) {
    const previous = current.transport === 'streamable-http' ? current.headers : {}
    next.headers = preserveMaskedMap(previous, patch.headers)
  }
  return next as McpServerDraft
}

function preserveMaskedMap(current: Record<string, string>, next: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(next).map(([name, value]) => {
    if (value !== MCP_REDACTED_VALUE) return [name, value]
    const previous = current[name]
    if (previous === undefined) throw new McpManagerError('MCP_INVALID_CONFIG', `masked value for new key "${name}" cannot be submitted`)
    return [name, previous]
  }))
}

function rejectAgentAuthLiterals(config: Record<string, unknown>): void {
  const secretKey = /(?:api[-_]?key|authorization|access[-_]?token|secret|password|token)/i
  for (const field of ['env', 'headers']) {
    const values = config[field]
    if (typeof values !== 'object' || values === null || Array.isArray(values)) continue
    for (const [key, value] of Object.entries(values)) {
      if (secretKey.test(key) && typeof value === 'string' && value.length > 0) {
        throw new McpManagerError('MCP_INVALID_CONFIG', `Agent installation cannot include a literal auth value in ${field}.${key}; install first, then configure auth in Settings`)
      }
    }
  }
}

function entryIdOf(id: McpServerId): string {
  return `${MANAGED_ENTRY_PREFIX}${id}`
}

function mintServerId(records: readonly McpServerRecord[]): McpServerId {
  let id: string
  do id = `server-${randomUUID().slice(0, 12)}`
  while (records.some(record => record.id === id))
  return id as McpServerId
}

function normalizeDraft(draft: McpServerDraft, id: McpServerId): McpServerRecord {
  const record = {
    ...draft,
    id,
    enabled: draft.enabled ?? true,
    toolCallTimeoutMs: draft.toolCallTimeoutMs ?? 60_000,
    failOnStartupError: draft.failOnStartupError ?? false,
    reconnect: {
      enabled: draft.reconnect?.enabled ?? true,
      initialDelayMs: draft.reconnect?.initialDelayMs ?? 500,
      maxDelayMs: draft.reconnect?.maxDelayMs ?? 30_000,
      maxAttempts: draft.reconnect?.maxAttempts ?? 10,
    },
  } as McpServerRecord
  try {
    validateServers({ servers: [record] })
  } catch (error) {
    throw new McpManagerError('MCP_INVALID_CONFIG', safeMessage(error))
  }
  return record
}

/** Keep error text useful without allowing an external server to flood the UI. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]').slice(0, 512)
}

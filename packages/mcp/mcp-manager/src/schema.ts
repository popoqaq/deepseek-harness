import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { McpServerRecord, McpServersSettings } from './types.ts'

/** Default per-tool operation deadline. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Default probe deadline. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000

/** Default reconnect policy shared with dsh-mcp-client. */
export const DEFAULT_RECONNECT = {
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
} as const

const reconnectSchema = z.object({
  enabled: z.boolean().default(DEFAULT_RECONNECT.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_RECONNECT.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_RECONNECT.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).default(DEFAULT_RECONNECT.maxAttempts),
})

const common = {
  id: z.string().required().pattern(/^[a-z][a-z0-9-]{2,63}$/),
  label: z.string(),
  serverName: z.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/),
  enabled: z.boolean().default(true),
  env: z.dict(String).default({}),
  credentialEnv: z.dict(String).default({}),
  toolCallTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: reconnectSchema,
}

/** Persisted settings schema for one managed stdio server. */
export const stdioServerSchema = z.object({
  ...common,
  transport: z.const('stdio'),
  command: z.string().required(),
  args: z.array(String).default([]),
  credentialHeaders: z.dict(String).default({}),
  cwd: z.string().default(''),
})

/** Persisted settings schema for one managed Streamable HTTP server. */
export const httpServerSchema = z.object({
  ...common,
  transport: z.const('streamable-http'),
  url: z.string().required(),
  headers: z.dict(String).default({}),
  credentialHeaders: z.dict(String).default({}),
})

/** Schema for a managed server record. */
export const serverSchema = z.union([stdioServerSchema, httpServerSchema]) as unknown as z<McpServerRecord>

/** Schema registered under the `mcp-servers` settings namespace. */
export const serversSettingsSchema: z<McpServersSettings> = z.object({
  servers: z.array(serverSchema).default([]),
})

/** Plugin-level manager configuration. */
export interface ManagerConfig {
  probeTimeoutMs?: number
}

/** Loader schema for the manager plugin itself. */
export const ManagerConfigSchema: z<ManagerConfig> = z.object({
  probeTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PROBE_TIMEOUT_MS),
})

/** Validate cross-record and cross-field constraints not expressible in the schema. */
export function validateServers(value: McpServersSettings): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const server of value.servers) {
    if (ids.has(server.id)) throw new Error(`mcp-servers: duplicate server id "${server.id}"`)
    ids.add(server.id)
    if (names.has(server.serverName)) throw new Error(`mcp-servers: duplicate serverName "${server.serverName}"`)
    names.add(server.serverName)
    for (const ref of Object.values(server.credentialEnv ?? {})) validateCredentialRef(ref)
    for (const ref of Object.values(server.credentialHeaders ?? {})) validateCredentialRef(ref)
    if (server.transport === 'stdio') {
      if (server.command.trim() === '') throw new Error(`mcp-servers: server "${server.id}" command is empty`)
    } else {
      let url: URL
      try {
        url = new URL(server.url)
      } catch {
        throw new Error(`mcp-servers: server "${server.id}" URL is invalid`)
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`mcp-servers: server "${server.id}" URL must use http or https`)
      }
      if (url.username !== '' || url.password !== '') {
        throw new Error(`mcp-servers: server "${server.id}" URL must not contain credentials`)
      }
    }
    if (server.reconnect.initialDelayMs > server.reconnect.maxDelayMs) {
      throw new Error(`mcp-servers: server "${server.id}" initialDelayMs must be <= maxDelayMs`)
    }
  }
}

function validateCredentialRef(ref: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error(`mcp-servers: invalid credential reference "${ref}"`)
}

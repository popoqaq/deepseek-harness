/** Client-safe contracts for the persisted MCP server manager. */

import type { Branded } from '@deepseek-ai/dsh-brand'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Published after a managed MCP server's runtime state changes. */
    'mcp-manager/changed'(id: McpServerId, state: McpServerState): void
  }
}

/** Stable identity of one managed MCP server. */
export type McpServerId = Branded<'McpServerId'>

/** Supported managed transports. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Persisted reconnect policy, matching dsh-mcp-client. */
export interface McpReconnectPolicy {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

interface McpServerCommon {
  id: McpServerId
  label?: string
  serverName: string
  enabled: boolean
  env: Record<string, string>
  credentialEnv: Record<string, string>
  credentialHeaders?: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: McpReconnectPolicy
}

/** User-owned desired configuration for one stdio MCP server. */
export interface McpStdioServerRecord extends McpServerCommon {
  transport: 'stdio'
  command: string
  args: string[]
  cwd: string
}

/** User-owned desired configuration for one Streamable HTTP MCP server. */
export interface McpHttpServerRecord extends McpServerCommon {
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
  credentialHeaders: Record<string, string>
}

/** User-owned desired configuration for one MCP server. */
export type McpServerRecord = McpStdioServerRecord | McpHttpServerRecord

/** Settings namespace value owned by the manager. */
export interface McpServersSettings {
  servers: McpServerRecord[]
}

/** Draft accepted by create/probe; the manager supplies the stable id. */
export type McpServerDraft =
  | Omit<McpStdioServerRecord, 'id'>
  | Omit<McpHttpServerRecord, 'id'>

/** Partial edit accepted by the manager; the stable id is never patchable. */
export type McpServerPatch =
  & Partial<Omit<McpServerCommon, 'id'>>
  & Partial<Pick<McpStdioServerRecord, 'command' | 'args' | 'cwd'>>
  & Partial<Pick<McpHttpServerRecord, 'url' | 'headers'>>
  & { transport?: McpTransport }

/** Marker used in browser-safe views for a configured literal value. */
export const MCP_REDACTED_VALUE = '[configured]'

/** Browser-safe state for one literal environment/header value. */
export interface McpValueView {
  configured: boolean
}

/** Stdio config projection safe to return through Remote. */
export type McpStdioServerViewConfig = Omit<McpStdioServerRecord, 'env'> & {
  env: Record<string, McpValueView>
}

/** HTTP config projection safe to return through Remote. */
export type McpHttpServerViewConfig = Omit<McpHttpServerRecord, 'env' | 'headers'> & {
  env: Record<string, McpValueView>
  headers: Record<string, McpValueView>
}

/** Browser-safe configuration projection. It contains no literal values. */
export type McpServerViewConfig = McpStdioServerViewConfig | McpHttpServerViewConfig

/** Runtime state of one managed server. */
export type McpServerState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'blocked'
  | 'failed'
  | 'exhausted'
  | 'stopped'

/** Credential state safe to return to a browser. */
export interface McpCredentialView {
  ref: string
  configured: boolean
  writable: boolean
  source?: string
}

/** One server view returned by the management Remote. */
export interface McpServerView {
  config: McpServerViewConfig
  state: McpServerState
  toolCount: number
  credentials: McpCredentialView[]
  error?: string
  updatedAt?: number
}

/** Point-in-time management view. */
export interface McpServerSnapshot {
  revision: number
  servers: McpServerView[]
}

/** Result from a non-mutating connection probe. */
export type McpProbeResult =
  | { ok: true; toolCount: number; toolNames: string[] }
  | { ok: false; code: string; message: string }

/** Stable manager failure code exposed in diagnostics. */
export type McpManagerErrorCode =
  | 'MCP_CONFIG_CONFLICT'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_CREDENTIAL_MISSING'
  | 'MCP_INVALID_CONFIG'

/** Request envelope for create. */
export interface McpCreateRequest {
  config: McpServerDraft
  expectedRevision?: number
}

/** Request envelope for update. */
export interface McpUpdateRequest {
  id: McpServerId
  patch: McpServerPatch
  expectedRevision?: number
}

/** Request envelope for deleting a server. */
export interface McpRemoveRequest {
  id: McpServerId
  expectedRevision?: number
}

/** Request envelope for enablement changes. */
export interface McpSetEnabledRequest {
  id: McpServerId
  enabled: boolean
  expectedRevision?: number
}

/** Request envelope for reconnection. */
export interface McpReconnectRequest {
  id: McpServerId
  expectedRevision?: number
}

/** Request envelope for probing a draft. */
export interface McpProbeRequest {
  config: McpServerDraft
}

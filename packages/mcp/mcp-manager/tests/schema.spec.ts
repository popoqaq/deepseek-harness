import { describe, expect, it } from 'vitest'
import { serverSchema, validateServers } from '@deepseek-ai/dsh-mcp-manager/src/schema.ts'
import { projectServerConfig } from '@deepseek-ai/dsh-mcp-manager/src/index.ts'
import type { McpServerId, McpServerRecord } from '@deepseek-ai/dsh-mcp-manager/src/types.ts'

const stdio = (overrides: Partial<McpServerRecord> = {}): McpServerRecord => ({
  id: 'local', label: 'Local', serverName: 'local', enabled: true, transport: 'stdio', command: 'node', args: [], cwd: '',
  env: {}, credentialEnv: {}, toolCallTimeoutMs: 1000, failOnStartupError: false,
  reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 10, maxAttempts: 1 },
  ...overrides,
} as McpServerRecord)

describe('MCP manager schema invariants', () => {
  it('accepts one valid stdio record', () => {
    expect(() => validateServers({ servers: [stdio()] })).not.toThrow()
  })

  it('rejects duplicate ids and namespaces', () => {
    expect(() => validateServers({ servers: [stdio(), stdio({ serverName: 'other' })] })).toThrow(/duplicate server id/)
    expect(() => validateServers({ servers: [stdio(), stdio({ id: 'other' as McpServerId })] })).toThrow(/duplicate serverName/)
  })

  it('rejects invalid credential references and URL credentials', () => {
    expect(() => validateServers({ servers: [stdio({ credentialEnv: { TOKEN: 'not a ref' } })] })).toThrow(/credential reference/)
    expect(() => validateServers({ servers: [stdio({
      id: 'remote', serverName: 'remote', transport: 'streamable-http', url: 'https://user:pass@example.test/mcp',
      headers: {}, credentialHeaders: {},
    } as never)] })).toThrow(/must not contain credentials/)
  })

  it('rejects a reconnect policy whose first delay exceeds its ceiling', () => {
    const reconnect = { enabled: true, initialDelayMs: 100, maxDelayMs: 10, maxAttempts: 1 }
    expect(() => validateServers({ servers: [stdio({ reconnect })] })).toThrow(/initialDelayMs/)
  })

  it('round-trips HTTP credential headers through the explicit schema field', () => {
    const record = serverSchema({
      id: 'remote' as McpServerId, serverName: 'remote', enabled: true, transport: 'streamable-http', url: 'https://example.test/mcp',
      env: {}, credentialEnv: {}, headers: {}, credentialHeaders: { Authorization: 'MCP_TOKEN' }, toolCallTimeoutMs: 1000,
      failOnStartupError: false, reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 10, maxAttempts: 1 },
    })
    expect(record.credentialHeaders).toEqual({ Authorization: 'MCP_TOKEN' })
  })

  it('projects literal env and headers without returning their values', () => {
    const record = stdio({ env: { TOKEN: 'secret-token' } })
    const view = projectServerConfig(record)
    expect(view.env).toEqual({ TOKEN: { configured: true } })
    expect(JSON.stringify(view)).not.toContain('secret-token')
  })
})

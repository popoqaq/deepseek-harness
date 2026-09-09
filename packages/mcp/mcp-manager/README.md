# @deepseek-ai/dsh-mcp-manager

Persisted MCP Server management for the Web profile. The manager stores desired
stdio or Streamable HTTP servers in the `mcp-servers` settings namespace and
projects enabled records into dynamic `@deepseek-ai/dsh-mcp-client` Loader
entries. MCP tools retain the stable `mcp__<serverName>__<tool>` naming contract.

Credential values are resolved only on the Host. Use `credentialEnv` and
`credentialHeaders` for secrets; literal `env`/`headers` values are never
returned by the Remote (the browser sees only configured markers). Missing
references produce a visible `blocked` state rather than starting a server with
an empty secret. The Remote surface supports list/create/update/remove,
enablement, reconnect, and non-mutating probe operations.

Only Tools are managed in this release. MCP Resources and Prompts remain
unsupported until Harness has a consumer contract for them. Stdio commands are
trusted Host executables and must not be entered through shell interpolation.

## Known Limitations and Deferred Work

- There is no marketplace or external configuration-file importer yet.
- Resource and Prompt management is deferred until the Harness has a durable
  consumer contract for those MCP capabilities.
- Streamable HTTP transport relies on the SDK's request/SSE recovery; the
  manager cannot respawn a remote HTTP service.

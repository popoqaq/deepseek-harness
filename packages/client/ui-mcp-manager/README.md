# @deepseek-ai/dsh-client-ui-mcp-manager

Web Settings contribution for `@deepseek-ai/dsh-mcp-manager`. It adds an MCP
tab under the existing Plugins Settings section and uses the generated Host
Remote for CRUD, probing, enablement, reconnect, and status refresh.

The browser never receives credential values. Credential references and status
are displayed through the existing credential API; MCP tools themselves remain
model-visible only through the Host-side MCP client bridge.

## Known Limitations and Deferred Work

- The first UI version edits the supported stdio and Streamable HTTP fields;
  marketplace discovery and external config import are deferred.
- Resources and Prompts are not shown because the Host has no consumer surface
  for them yet.

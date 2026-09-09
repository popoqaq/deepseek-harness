# Agent Note: Persisted MCP server manager

Status: implemented

English | [中文](2026-08-18-persisted-mcp-server-manager.zh.md)

## Problem

`dsh-mcp-client` connects one configured MCP server and owns its tool lifecycle, but a Web user had no durable control plane for adding, validating, reconnecting, disabling, or removing servers. Editing Loader configuration for every change exposes process configuration without presenting the connection state that determines whether its tools are usable.

## Decision

`@deepseek-ai/dsh-mcp-manager` owns the persisted `mcpManager` settings namespace and reconciles every enabled record into one dynamic `dsh-mcp-client` Loader child. It publishes a browser-safe snapshot and forwards status changes through the generated Remote API. The Web bundle mounts `@deepseek-ai/dsh-client-ui-mcp-manager` as a Settings tab; its adapter unwraps each Remote result before handing business values to the React component.

Server records retain credential references rather than secret values. A fresh installation starts no MCP process: a child appears only after a user saves an enabled server. The manager may reconnect or probe a record, while the MCP client remains the owner of transports, discovery, tool registration, and teardown.

## Alternatives considered

- **Expose raw Loader entries in Settings** — rejected because generic Loader configuration cannot validate MCP records, hide credentials, or present the client supervisor's state without importing MCP-specific behavior into a generic settings surface.
- **Duplicate the client supervisor in the Web plugin** — rejected because browser state cannot own Host transports or tool registration and would create two lifecycle authorities.
- **Keep static `cordis.yml` rows as the only path** — rejected because they require manual configuration edits and provide no persisted Web management path; direct rows remain available for deployments that choose configuration-managed servers.

## Consequences

The manager adds a Web-only operational path while preserving `dsh-mcp-client` as the single transport and tool owner. Management calls return the standard Remote result envelope; the UI adapter converts a failure branch into a diagnostic before rendering. Coverage includes manager schema validation, the real MCP probe path, and the browser plugin's injected services plus Remote success and failure handling.

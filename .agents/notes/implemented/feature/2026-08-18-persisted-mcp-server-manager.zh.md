# Agent Note: 持久化 MCP 服务器管理器

Status: implemented

[English](2026-08-18-persisted-mcp-server-manager.md) | 中文

## 问题

`dsh-mcp-client` 连接一个已配置的 MCP 服务器并拥有其工具生命周期，但 Web 用户没有可持久化的控制面来添加、校验、重连、禁用或删除服务器。每次变更都编辑 Loader 配置会暴露进程配置，而且不会呈现决定其工具是否可用的连接状态。

## 决策

`@deepseek-ai/dsh-mcp-manager` 拥有持久化的 `mcpManager` 设置命名空间，并将每个启用记录协调为一个动态 `dsh-mcp-client` Loader 子项。它发布浏览器安全的快照，并通过生成的 Remote API 转发状态变化。Web 组合包把 `@deepseek-ai/dsh-client-ui-mcp-manager` 挂载为设置页标签；其适配器在把业务值交给 React 组件前解包每个 Remote 结果。

服务器记录保留凭据引用而非密钥值。全新安装不会启动 MCP 进程：只有用户保存启用的服务器后才会创建子项。管理器可以重连或探测记录，而 MCP client 仍是传输、发现、工具注册和清理的归属方。

## 考虑过的替代方案

- **在设置页暴露原始 Loader 条目**——不采用，因为通用 Loader 配置无法校验 MCP 记录、隐藏凭据或呈现 client supervisor 状态，除非把 MCP 特定行为引入通用设置界面。
- **在 Web 插件中复制 client supervisor**——不采用，因为浏览器状态不能拥有 Host 传输或工具注册，并会形成两个生命周期归属方。
- **仅保留静态 `cordis.yml` 条目**——不采用，因为它们要求手动编辑配置且没有持久化 Web 管理路径；对于选择配置管理服务器的部署，直接条目仍可使用。

## 后果

管理器增加仅限 Web 的运维路径，同时保留 `dsh-mcp-client` 作为唯一的传输与工具归属方。管理调用返回标准 Remote 结果封套；UI 适配器在渲染前把失败分支转换为诊断。覆盖包括管理器 schema 校验、真实 MCP 探测路径，以及浏览器插件的注入服务和 Remote 成功、失败处理。

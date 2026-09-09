# 自选股看盘插件设计规格

## 背景

DSH Web 的会话 Header 已提供 `conversation.session.header.utilities` 列表插槽，适合承载不改变会话内容的轻量工具。目标是新增一个可独立加载、可独立禁用和可热更新的客户端插件，在 Header 中显示自选股微型看板，并通过点击弹层管理自选股。

当前仓库没有浏览器可直接调用的通达信行情 Remote。MCP 客户端桥接把 MCP 工具注册到 Host 的模型工具运行时，而不是浏览器 API，因此客户端插件不能直接调用 MCP。行情请求必须经过 Host Remote，由 Host 侧适配器调用已配置的通达信/MCP能力并返回受约束的行情 DTO。

## 目标

1. Header 横向显示自选股的代码/名称、最新价和涨跌幅。
2. 点击看板打开列表弹层，支持按股票代码或名称添加、删除、去重。
3. 自选股在浏览器端持久化，刷新页面后恢复。
4. 通过批量行情 Remote 获取报价，默认约 15 秒刷新；行情失败时保留上次成功值并明确标记过期。
5. 行情能力未配置或不可用时，插件仍可管理自选股，不伪造价格。
6. 插件遵循 DSH 客户端插件加载模型，通过 roster 组合，不把业务代码放进 Web Shell。

## 非目标

- 第一版不做账号级、跨设备同步。
- 第一版不实现完整 K 线、分时图、盘口五档、资讯或交易下单。
- 第一版不在浏览器暴露 MCP 地址、密钥或直接连接第三方行情服务。
- 第一版不把 MCP 工具列表动态暴露给浏览器；Host 适配器负责固定、校验和归一化行情调用。

## 方案选择

### 推荐：客户端插件 + Host Remote + Host 行情适配器

客户端只依赖一个 typed Remote 和标准 Header slot；Host Remote 负责鉴权、超时、错误归一化和批量请求，适配器负责调用当前部署可用的通达信/MCP能力。这样浏览器不关心 MCP 工具名称和返回格式，也不会泄露凭据。

浏览器本地保存自选股目录，Remote 只处理解析和报价。若 Host 没有行情适配器，Remote 返回明确的 `quote-unavailable` 错误；列表和添加/删除仍然可用。

### 放弃：浏览器直连行情服务

会引入 CORS、密钥泄露、不同部署的网络可达性和接口限流问题，并且让客户端插件绑定某家行情服务。

### 放弃：修改核心 Header Shell

会让功能无法独立组合、禁用和热更新，也违背当前客户端插件 roster 的边界。

## 客户端架构

新增 `packages/client/ui-watchlist`，声明 `dsh.client`，依赖 `slots`、`locale`、`connection`。插件 `apply` 注册词典，并向 `conversation.session.header.utilities` 注入一个有序条目。

组件划分：

- `WatchlistController`：管理自选股目录、报价快照、加载状态、错误和刷新定时器；对外提供不可变 store。
- `WatchlistStorage`：读取/校验/写入 `localStorage`，键为 `dsh.watchlist.v1`；损坏数据按空列表处理并记录可见错误。
- `WatchlistUtility`：Header 中的横向微型看板；使用主题 token，限制最大宽度并通过 `+N` 表示溢出。
- `WatchlistPopover`：弹层列表、添加输入、删除操作、刷新按钮、更新时间和错误提示。
- `quotes.ts`：只定义浏览器使用的 DTO、Remote 调用和规范化函数，不依赖 Host 实现。

自选股记录采用稳定结构：

```ts
interface WatchlistItem {
  symbol: string       // 归一化市场代码，例如 600519.SH
  name: string
  addedAt: number
}

interface QuoteSnapshot {
  symbol: string
  name: string
  price: number | null
  changePercent: number | null
  asOf: string | null
  stale: boolean
}
```

添加流程先调用 `watchlist.lookup` 解析输入，成功后以 `symbol` 去重再写入本地存储；没有行情服务时，如果输入已经符合明确的市场代码格式，则允许以代码加入、名称显示为代码，避免管理功能被行情依赖阻断。

报价流程批量调用 `watchlist.quotes({ symbols })`，只在存在自选股且 Header 可见时刷新。初始加载立即请求一次，之后按 15 秒定时刷新；弹层打开时允许手动刷新。请求使用上一代结果防护，较晚返回的旧请求不能覆盖新请求。失败按单次请求记录错误，保留旧值并将其标记为 `stale`。

## Host Remote 与行情适配器

在 Host API contract 中新增两个方法：

- `watchlist.lookup({ query })` → `{ items: Array<{ symbol; name }> }`
- `watchlist.quotes({ symbols })` → `{ quotes: QuoteDto[]; asOf: string }`

Remote 必须限制输入长度、股票数量和单次调用超时，并将适配器错误归一化为稳定错误码：`invalid-symbol`、`quote-unavailable`、`quote-timeout`、`quote-rate-limited`、`internal`。返回值只允许稳定的字符串、有限数值和 ISO 时间，不把 MCP 原始内容、密钥或工具诊断传到浏览器。

Host 适配器通过明确的服务接口调用部署已配置的通达信/MCP能力，而不是让客户端传入任意工具名。适配器负责：

1. 将规范化股票代码转换为供应商格式。
2. 调用供应商能力并解析固定字段。
3. 丢弃不完整/非有限价格，保留可识别的错误。
4. 对同一批股票执行上限和超时控制。
5. 在能力未安装时返回 `quote-unavailable`，而不是启动隐藏的外部进程。

## 交互与可访问性

- 看板入口是 `button`，有稳定的 `aria-label` 和 `aria-expanded`。
- 弹层使用对话框语义，打开后焦点进入添加输入，Escape 关闭并回到入口。
- 删除按钮使用股票名称和代码生成可读的 `aria-label`。
- 颜色只表达涨跌，文本同时显示带符号的百分比，不能仅依赖颜色。
- 空列表显示说明和添加入口；行情不可用显示状态文案，不显示错误堆栈。
- Header 空间不足时内容不产生横向滚动；弹层在窄窗口内限制宽度并可滚动。

## 生命周期与错误处理

插件卸载时必须清除定时器、订阅、弹层事件和注册的 slot。连接重置后 Controller 清理进行中的请求并在下一次可用时重试，不丢失本地自选股。localStorage 写入失败时保留内存状态并显示非阻塞提示。

Remote 失败不会删除用户目录。单个报价缺失只影响对应行；批量请求失败时所有已有报价标记为过期。任何来自 Host 的数据都在客户端二次校验，异常条目降级为 `--`。

## 测试策略

- `WatchlistStorage`：空值、损坏 JSON、重复代码、非法记录、写入异常。
- `WatchlistController`：添加/删除/去重、竞态响应、定时刷新、旧报价保留和 stale 标记。
- `WatchlistUtility`：横向渲染、涨跌文案、溢出 `+N`、空列表和错误状态。
- `WatchlistPopover`：打开/关闭、添加成功/重复/失败、删除、Escape 焦点回收、可访问名称。
- 插件 apply：locale 和 Header slot 注册、依赖声明、卸载清理。
- Host Remote：输入边界、错误码归一化、适配器缺失、返回 DTO 校验。
- 包构建：客户端 bundle、Host 类型生成和 Web roster 校验。

## 组合与验证

在 `packages/bundle/web-app/cordis.patch.yml` 增加 `ui-watchlist` roster 行。客户端包的 `package.json` 声明 `exports["./client"]`、`dsh.client` 和依赖关系；Host 适配器随 Web 配置组合，但未配置时仍能启动并提供可用的目录管理界面。

验证顺序：先运行新增包的单元/组件测试和 Host Remote 测试，再运行相关包构建；启动现有 `dsh web` 后刷新 `http://127.0.0.1:3080`，验证 Header 看板、弹层增删、刷新和行情不可用降级。若开发 watcher 未运行，不承诺客户端改动自动热更新，需重建 bundle 后刷新页面。

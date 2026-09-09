# 自选股看盘插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH Web Header 中增加可独立加载的自选股微型看板，并通过 Host Remote/通达信 MCP 适配器提供行情、添加、删除、持久化和刷新能力。

**Architecture:** 新增一个 `@deepseek-ai/dsh-client-ui-watchlist` 客户端插件，占用现有 `conversation.session.header.utilities` 列表插槽，使用浏览器 `localStorage` 持久化自选股。Host API contract 增加 `watchlist.lookup` 与 `watchlist.quotes` 两个类型化 RPC，Host 实现通过可选的 `ctx.tools` 调用固定的通达信 MCP 工具并把结果归一化；没有工具时返回稳定的 `quote-unavailable` 错误，客户端仍可管理本地目录。

**Tech Stack:** TypeScript, React 18, Cordis client plugins, DSH typed ApiProxy/RPC, Typert remotes, Vitest, React Testing Library, Vite/tsdown.

**Spec:** `docs/superpowers/specs/2026-08-19-watchlist-plugin-design.md`

## Global Constraints

- Header 插件必须使用 `conversation.session.header.utilities`，不得修改 Web Shell 或核心 Header 组件。
- 行情只通过 Host Remote 获取；浏览器不得暴露 MCP 地址、密钥或任意工具名。
- 自选股使用 `localStorage` 键 `dsh.watchlist.v1`，第一版不做账号级和跨设备同步。
- 报价默认每 15 秒刷新；请求失败必须保留旧值并标记 `stale`，首次无值显示 `--`。
- 所有 Host 返回的行情数据在客户端二次校验；不输出未经验证的价格或涨跌幅。
- 不修改工作区中与本功能无关的既有未提交文件。
- 每个任务先写失败测试，再写最小实现，再运行该任务的定向测试。

---

## 文件地图

- Create: `packages/host/apiproxy/src/api/watchlist.ts` — WatchlistApi 接口和 DTO 类型。
- Create: `packages/host/apiproxy/src/api/watchlist.schema.ts` — watchlist RPC 的请求/响应 schema。
- Modify: `packages/host/apiproxy/src/api/index.ts` — 导出 WatchlistApi、DTO。
- Modify: `packages/host/apiproxy/src/api/rpc-map.ts` — 注册 `watchlist.lookup` 与 `watchlist.quotes`。
- Modify: `packages/host/apiproxy/src/api-proxy.ts` — 实现两个 Host API handler 和可选 MCP 工具适配。
- Modify: `packages/host/apiproxy/src/fetch/handler.ts` — add the two `UNARY_ROUTES` entries, schemas, and signal forwarding.
- Modify: `packages/client/connection/src/client/api.ts` — 向浏览器安全 contract 重新导出 watchlist API 类型。
- Modify: `packages/client/connection/src/client/fixture.ts` — 给测试 fixture 增加 deterministic watchlist handlers。
- Do not modify: `packages/api/remotes/src/client/index.ts` — this feature uses the existing typed `connection.api` RPC face, not a Cordis Remote contribution.
- Create: `packages/client/ui-watchlist/package.json` — 客户端插件 manifest、exports、依赖和 bundle scripts。
- Create: `packages/client/ui-watchlist/src/client/index.ts` — 插件 apply、locale 注册、slot 注入。
- Create: `packages/client/ui-watchlist/src/client/locales.ts` — zh/en 文案。
- Create: `packages/client/ui-watchlist/src/client/types.ts` — 客户端 WatchlistItem/QuoteSnapshot/状态类型。
- Create: `packages/client/ui-watchlist/src/client/storage.ts` — localStorage 解析、校验和持久化。
- Create: `packages/client/ui-watchlist/src/client/controller.ts` — store、增删、lookup、quotes、定时刷新和竞态防护。
- Create: `packages/client/ui-watchlist/src/client/WatchlistUtility.tsx` — Header 横向微型看板和入口按钮。
- Create: `packages/client/ui-watchlist/src/client/WatchlistPopover.tsx` — 弹层列表、添加输入、删除、刷新和错误状态。
- Create: `packages/client/ui-watchlist/src/client/watchlist.module.css` — Header 与弹层样式。
- Create: `packages/client/ui-watchlist/tests/storage.client.spec.ts` — storage contract tests。
- Create: `packages/client/ui-watchlist/tests/controller.client.spec.ts` — controller state/async tests。
- Create: `packages/client/ui-watchlist/tests/components.client.spec.tsx` — UI interaction/accessibility tests。
- Create: `packages/client/ui-watchlist/tests/apply.client.spec.ts` — plugin apply/slot lifecycle tests。
- Modify: `packages/bundle/web-app/cordis.patch.yml` — add `ui-watchlist` browser roster row。
- Modify: workspace package metadata/lockfile only if the repository’s package manager requires it after adding the workspace package.

---

### Task 1: Add the typed Host watchlist contract

**Files:**
- Create: `packages/host/apiproxy/src/api/watchlist.ts`
- Create: `packages/host/apiproxy/src/api/watchlist.schema.ts`
- Modify: `packages/host/apiproxy/src/api/index.ts`
- Modify: `packages/host/apiproxy/src/api/rpc-map.ts`
- Modify: `packages/client/connection/src/client/api.ts`
- Test: `packages/host/apiproxy/tests/watchlist-api.spec.ts` — new focused contract/schema tests.

**Interfaces:**
- Produces `WatchlistApi.lookup(request): Promise<RpcResponse<{ items: WatchlistLookupItem[] }>>`.
- Produces `WatchlistApi.quotes(request, signal?): Promise<RpcResponse<{ quotes: WatchlistQuoteDto[]; asOf: string }>>`.
- `WatchlistLookupItem = { symbol: string; name: string }`.
- `WatchlistQuoteDto = { symbol: string; name: string; price: number | null; changePercent: number | null; asOf: string | null }`.
- `RpcMethodMap` keys are exactly `'watchlist.lookup'` and `'watchlist.quotes'`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('derives watchlist request and response types from the RPC map', () => {
  type LookupPayload = RequestPayload<'watchlist.lookup'>
  type QuotesValue = ResponseValue<'watchlist.quotes'>
  const payload: LookupPayload = { query: '茅台' }
  const value: QuotesValue = { quotes: [], asOf: '2026-08-19T00:00:00.000Z' }
  expect(payload.query).toBe('茅台')
  expect(value.quotes).toEqual([])
})

it('rejects an empty quote batch at the schema boundary', () => {
  expect(() => watchlistQuotesRequestSchema.parse({ symbols: [] })).toThrow()
})
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm exec vitest run packages/host/apiproxy/tests/watchlist-api.spec.ts`
Expected: FAIL because the watchlist API types/schema/map entries do not exist.

- [ ] **Step 3: Implement the contract**

Use the existing API domain pattern. The public signatures should be equivalent to:

```ts
export interface WatchlistApi {
  lookup(request: RpcRequest<{ query: string }>): Promise<RpcResponse<{ items: WatchlistLookupItem[] }>>
  quotes(request: RpcRequest<{ symbols: string[] }>, signal?: AbortSignal): Promise<RpcResponse<{ quotes: WatchlistQuoteDto[]; asOf: string }>>
}

export interface ApiProxy { /* existing fields */ watchlist: WatchlistApi }

export interface RpcMethodMap {
  /* existing methods */
  'watchlist.lookup': WatchlistApi['lookup']
  'watchlist.quotes': WatchlistApi['quotes']
}
```

Set limits in the schema: lookup query 1–64 Unicode code points, quote batch 1–50 symbols, each symbol 1–24 ASCII code points. Require finite numbers when `price` or `changePercent` is not null, and require ISO-like strings for timestamps. Re-export the types through the browser-safe connection API.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `pnpm exec vitest run packages/host/apiproxy/tests/watchlist-api.spec.ts && pnpm exec tsc -p packages/host/apiproxy/tsconfig.json --noEmit`
Expected: PASS with no new type errors.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/host/apiproxy/src/api/watchlist.ts packages/host/apiproxy/src/api/watchlist.schema.ts packages/host/apiproxy/src/api/index.ts packages/host/apiproxy/src/api/rpc-map.ts packages/client/connection/src/client/api.ts packages/host/apiproxy/tests/watchlist-api.spec.ts
git commit -m "feat: add watchlist quote RPC contract"
```

---

### Task 2: Implement Host handlers and the MCP adapter boundary

**Files:**
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/host/apiproxy/src/fetch/handler.ts` — add `watchlist.lookup` and `watchlist.quotes` to the existing `UNARY_ROUTES` table.
- Modify: `packages/client/connection/src/client/fixture.ts`
- Test: `packages/host/apiproxy/tests/watchlist-handler.spec.ts`

**Interfaces:**
- Consumes `WatchlistApi` from Task 1 and `ctx.tools` from the existing Host tool registry.
- Produces `ctx.tools.execute({ callId, name, arguments, signal })` calls using fixed names `mcp__tdx-finance__tdx_lookup_stock` and `mcp__tdx-finance__tdx_quotes`.
- Produces stable errors: `invalid-symbol`, `quote-unavailable`, `quote-timeout`, `quote-rate-limited`, and `internal`.

- [ ] **Step 1: Write failing handler tests**

```ts
it('returns quote-unavailable when the fixed TDX tool is not registered', async () => {
  const response = await api.watchlist.quotes(request({ symbols: ['600519.SH'] }))
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('expected error')
  expect(response.result.error.code).toBe('quote-unavailable')
})

it('normalizes finite quote fields and drops malformed rows', async () => {
  tools.execute = async () => toolText(JSON.stringify({
    quotes: [
      { symbol: '600519.SH', name: '贵州茅台', price: 1510.5, changePercent: 1.2 },
      { symbol: '000001.SZ', name: '平安银行', price: 'bad', changePercent: 2 },
    ],
  }))
  const response = await api.watchlist.quotes(request({ symbols: ['600519.SH', '000001.SZ'] }))
  expect(response.result).toEqual({ ok: true, value: { quotes: [{ symbol: '600519.SH', name: '贵州茅台', price: 1510.5, changePercent: 1.2, asOf: expect.any(String) }], asOf: expect.any(String) } })
})
```

- [ ] **Step 2: Run the handler tests and verify failure**

Run: `pnpm exec vitest run packages/host/apiproxy/tests/watchlist-handler.spec.ts`
Expected: FAIL because `api.watchlist` and the adapter are not implemented.

- [ ] **Step 3: Implement the fixed adapter boundary**

Add a small private adapter in the existing Host API implementation. It must not accept a tool name from the browser. It should:

1. Check `ctx.get('tools')` and `tools.get(fixedName)` before executing.
2. Call the fixed tool with a generated `CallId`, the request signal, and a JSON-safe payload.
3. Accept text JSON from MCP results and reject non-JSON/malformed content.
4. Map unavailable tools, timeouts, rate limits, and other errors to the stable codes.
5. Return `{ symbol, name, price, changePercent, asOf }` only for validated rows.
6. Use a per-request timeout derived from the incoming signal and cap at 5 seconds.

For lookup, use the fixed lookup tool when available; if it is unavailable and the query matches `^(?:[036]\d{5})(?:\.(?:SH|SZ|BJ))?$`, return one fallback item with `name=query`. Never invent a name for a non-code query.

- [ ] **Step 4: Add fixture handlers and run tests**

Extend the in-process fixture switch with `watchlist.lookup` and `watchlist.quotes` deterministic handlers so client tests can call the typed API without a real MCP server. Run:

`pnpm exec vitest run packages/host/apiproxy/tests/watchlist-api.spec.ts packages/host/apiproxy/tests/watchlist-handler.spec.ts packages/client/connection/tests/client-apply.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Host implementation**

```bash
git add packages/host/apiproxy/src/api-proxy.ts packages/host/apiproxy/src packages/client/connection/src/client/fixture.ts packages/host/apiproxy/tests/watchlist-handler.spec.ts
git commit -m "feat: serve watchlist quotes through TDX adapter"
```

---

### Task 3: Build storage and controller state before the UI

**Files:**
- Create: `packages/client/ui-watchlist/package.json`
- Create: `packages/client/ui-watchlist/src/client/types.ts`
- Create: `packages/client/ui-watchlist/src/client/storage.ts`
- Create: `packages/client/ui-watchlist/src/client/controller.ts`
- Create: `packages/client/ui-watchlist/tests/storage.client.spec.ts`
- Create: `packages/client/ui-watchlist/tests/controller.client.spec.ts`

**Interfaces:**
- `readWatchlist(storage = globalThis.localStorage): WatchlistItem[]`.
- `writeWatchlist(items, storage = globalThis.localStorage): void`.
- `WatchlistController` methods: `add(query): Promise<AddResult>`, `remove(symbol): void`, `refresh(): Promise<void>`, `open(): void`, `close(): void`, `dispose(): void`.
- `WatchlistController.store` exposes `{ items, quotes, loading, open, error, updatedAt }` through `getSnapshot/subscribe`.

- [ ] **Step 1: Write failing storage tests**

```ts
it('drops malformed and duplicate records while preserving order', () => {
  localStorage.setItem('dsh.watchlist.v1', JSON.stringify([
    { symbol: '600519.SH', name: '贵州茅台', addedAt: 1 },
    { symbol: '600519.SH', name: 'duplicate', addedAt: 2 },
    { symbol: '', name: 'bad', addedAt: 3 },
  ]))
  expect(readWatchlist()).toEqual([{ symbol: '600519.SH', name: '贵州茅台', addedAt: 1 }])
})
```

- [ ] **Step 2: Run storage tests and verify failure**

Run: `pnpm exec vitest run packages/client/ui-watchlist/tests/storage.client.spec.ts`
Expected: FAIL because the package and storage module do not exist.

- [ ] **Step 3: Implement storage and controller**

Use `useSyncExternalStore`-compatible state and a monotonically increasing request token. The controller must persist immediately after add/remove, listen to the browser `storage` event, and set `stale: true` on existing quotes after a failed refresh. `refresh()` must ignore a response whose token is not current.

The controller calls the typed API as follows:

```ts
await api.watchlist.lookup({ query })
await api.watchlist.quotes({ symbols: items.map(item => item.symbol) })
```

Normalise all returned rows with finite-number checks before storing them. Schedule the 15-second timer only while the controller is mounted and the list is non-empty; clear it in `dispose()`.

- [ ] **Step 4: Add controller tests and run them**

Cover add success, duplicate rejection without a second write, delete persistence, quote-unavailable fallback, stale quote retention, old response suppression, and timer cleanup. Run:

`pnpm exec vitest run packages/client/ui-watchlist/tests/storage.client.spec.ts packages/client/ui-watchlist/tests/controller.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the state layer**

```bash
git add packages/client/ui-watchlist
git commit -m "feat: add watchlist persistence and quote state"
```

---

### Task 4: Add Header utility, popover UI, and plugin lifecycle

**Files:**
- Create: `packages/client/ui-watchlist/src/client/index.ts`
- Create: `packages/client/ui-watchlist/src/client/locales.ts`
- Create: `packages/client/ui-watchlist/src/client/WatchlistUtility.tsx`
- Create: `packages/client/ui-watchlist/src/client/WatchlistPopover.tsx`
- Create: `packages/client/ui-watchlist/src/client/watchlist.module.css`
- Create: `packages/client/ui-watchlist/tests/components.client.spec.tsx`
- Create: `packages/client/ui-watchlist/tests/apply.client.spec.ts`

**Interfaces:**
- Consumes `WatchlistController` from Task 3.
- Produces one `conversation.session.header.utilities` entry with id `watchlist`, order `30`, locale namespace `watchlist`.
- `WatchlistUtility` is a `button` with `aria-expanded`, and renders the popover when open.

- [ ] **Step 1: Write failing component tests**

```tsx
it('opens the list, adds a symbol, and removes it accessibly', async () => {
  render(<WatchlistUtility controller={controller} />)
  await user.click(screen.getByRole('button', { name: /自选股/ }))
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.type(screen.getByRole('textbox', { name: /添加股票/ }), '600519')
  await user.click(screen.getByRole('button', { name: /添加/ }))
  expect(await screen.findByText('贵州茅台')).toBeVisible()
  await user.click(screen.getByRole('button', { name: /删除 贵州茅台/ }))
  expect(screen.queryByText('贵州茅台')).toBeNull()
})
```

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm exec vitest run packages/client/ui-watchlist/tests/components.client.spec.tsx`
Expected: FAIL because the UI and plugin package do not exist.

- [ ] **Step 3: Implement the UI**

Render at most four compact chips in the Header and then a `+N` chip. Each chip shows the name/code, price or `--`, and signed change percent or `--`; add `data-stale` when the quote is stale. The button opens a positioned popover with:

- `<div role="dialog" aria-label="自选股列表">`;
- focused add textbox on open;
- add submit button and inline validation/error text;
- rows with stable `key={symbol}` and delete buttons;
- manual refresh button and last-update text;
- Escape handling that closes and returns focus to the Header button.

Do not use a global portal unless the existing primitives require it; keep the popover inside the slot entry so disposal removes it with the plugin.

- [ ] **Step 4: Register the plugin and run tests**

`index.ts` must export `inject = ['connection', 'slots', 'locale']`, register `zh/en`, instantiate one controller from the connection handle, and inject the Header slot. Return all controller and slot disposers from the Cordis effect. Add tests asserting the dependency list, slot id/order, locale registration, and disposal.

Run:

`pnpm exec vitest run packages/client/ui-watchlist/tests/components.client.spec.tsx packages/client/ui-watchlist/tests/apply.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the client plugin**

```bash
git add packages/client/ui-watchlist
 git commit -m "feat: add watchlist header plugin"
```

---

### Task 5: Compose the plugin and run package/build verification

**Files:**
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: workspace package metadata/lockfile only if required by the package manager.
- Test: `packages/client/ui-watchlist/tests/*`, existing Web plugin/config tests as needed.

**Interfaces:**
- Consumes the package manifest from Task 4.
- Produces a roster row:

```yaml
- id: ui-watchlist
  name: '@deepseek-ai/dsh-client-ui-watchlist'
```

- [ ] **Step 1: Add the roster row and package exports**

Place the row near the other Header/session utility plugins (`ui-jobs`), preserve the existing ordering comments, and ensure `package.json` contains:

```json
{
  "exports": { "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web", "inject": ["connection", "slots", "locale"] } },
  "scripts": { "bundle": "tsdown", "watch": "tsdown --watch" }
}
```

- [ ] **Step 2: Run focused tests and package build**

Run:

`pnpm exec vitest run packages/client/ui-watchlist/tests packages/host/apiproxy/tests/watchlist-api.spec.ts packages/host/apiproxy/tests/watchlist-handler.spec.ts`

Then:

`pnpm --filter @deepseek-ai/dsh-client-ui-watchlist run bundle`

Expected: all tests PASS and `lib/client.js` plus declarations are emitted.

- [ ] **Step 3: Run repository validation**

Run the repository’s existing validation commands from `package.json` (inspect scripts first), then at minimum:

`pnpm exec verify-cordis-config`
`pnpm --filter @deepseek-ai/dsh-web-frontend run build`

Expected: the client manifest/roster audit accepts the new package and Vite builds the Web shell.

- [ ] **Step 4: Verify the live GUI**

Check whether `pnpm run dev:web` is already running in this checkout. If it is not running, build the affected client package and Web artifacts before verification. Do not start a replacement DSH server.

Refresh `http://127.0.0.1:3080` and verify:

1. Header shows the empty “自选股” entry.
2. Clicking it opens the dialog and focuses the add field.
3. Adding `600519` persists after refresh; duplicate add is rejected.
4. Delete removes the row and the Header chip.
5. With no configured TDX tool, the UI keeps the item and shows `--`/行情不可用 rather than fake values.
6. With the configured MCP adapter available, a manual refresh renders validated price/change values.

- [ ] **Step 5: Commit the composition and record evidence**

```bash
git add packages/bundle/web-app/cordis.patch.yml packages/client/ui-watchlist/package.json
git commit -m "feat: compose watchlist web plugin"
```

Record the exact test/build commands and their outputs in the final response; do not claim live quote values unless the configured MCP adapter actually returned them.

/** Watchlist dictionary namespace. @module dsh-client-ui-watchlist/locales */

/** Dictionary namespace owned by this plugin. */
export const NS = 'watchlist'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '自选股',
  'open': '打开自选股列表',
  'add': '添加',
  'addPlaceholder': '代码或名称，如 600519 或 贵州茅台',
  'remove': '移除',
  'empty': '还没有自选股。输入代码或名称添加。',
  'refresh': '刷新行情',
  'lastUpdated': '更新于 {time}',
  'stale': '行情刷新失败，显示的是上次成功值',
  'quoteUnavailable': '行情能力未配置，可管理自选股但不会显示价格',
  'invalidSymbol': '无法识别该代码，请使用 6 位 A 股代码（如 600519）',
  'dup': '已在自选股中',
  'added': '已添加 {name}',
  'noQuote': '—',
} as const

export type WatchlistKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Watchlist',
  'open': 'Open watchlist',
  'add': 'Add',
  'addPlaceholder': 'Code or name, e.g. 600519',
  'remove': 'Remove',
  'empty': 'No watchlist entries yet. Add a code or name.',
  'refresh': 'Refresh quotes',
  'lastUpdated': 'Updated {time}',
  'stale': 'Quote refresh failed; showing last successful values',
  'quoteUnavailable': 'Quote capability is not configured — the watchlist is manageable without prices',
  'invalidSymbol': 'Unrecognized symbol; use a 6-digit A-share code such as 600519',
  'dup': 'Already on the watchlist',
  'added': 'Added {name}',
  'noQuote': '—',
} satisfies Record<WatchlistKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header watchlist copy. */
    'watchlist': WatchlistKey
  }
}

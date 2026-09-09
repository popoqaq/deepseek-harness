/**
 * Browser-local watchlist persistence (key `dsh.watchlist.v1`). Corrupt data
 * degrades to an empty list; storage failures are never fatal.
 * @module dsh-client-ui-watchlist/storage
 */

import type { WatchlistItem } from './types.ts'

export const WATCHLIST_STORAGE_KEY = 'dsh.watchlist.v1'

/** A minimal synchronous storage surface (localStorage in the browser). */
export interface WatchlistStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function normalizeEntry(value: unknown): WatchlistItem | null {
  if (value === null || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (typeof entry.symbol !== 'string' || typeof entry.name !== 'string'
    || typeof entry.addedAt !== 'number' || !Number.isFinite(entry.addedAt)) return null
  const symbol = entry.symbol.trim()
  const name = entry.name.trim()
  return symbol !== '' && name !== '' ? { symbol, name, addedAt: entry.addedAt } : null
}

/** Read the persisted watchlist; corrupt or absent data becomes `[]`. */
export function readWatchlist(storage: WatchlistStorage = globalThis.localStorage): WatchlistItem[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const items: WatchlistItem[] = []
    for (const value of parsed) {
      const entry = normalizeEntry(value)
      if (entry !== null && !seen.has(entry.symbol)) {
        seen.add(entry.symbol)
        items.push(entry)
      }
    }
    return items
  } catch {
    return []
  }
}

/** Write the watchlist; storage failures are swallowed (surfaces still work in-memory). */
export function writeWatchlist(items: readonly WatchlistItem[], storage: WatchlistStorage = globalThis.localStorage): void {
  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore quota/security failures — the in-memory list stays authoritative for the page.
  }
}

/**
 * Normalize free-form input into a market symbol. Accepts `600519`,
 * `600519.SH`, `sh600519`, `000001`, `sz000001`; returns null otherwise.
 */
export function normalizeSymbol(input: string): string | null {
  const raw = input.trim().toLowerCase()
  const explicit = /^([0-9]{6})\.(sh|sz)$/.exec(raw)
  if (explicit !== null && explicit[1] !== undefined && explicit[2] !== undefined) {
    return `${explicit[1]}.${explicit[2].toUpperCase()}`
  }
  const prefixed = /^(sh|sz)([0-9]{6})$/.exec(raw)
  if (prefixed !== null && prefixed[1] !== undefined && prefixed[2] !== undefined) {
    return `${prefixed[2]}.${prefixed[1].toUpperCase()}`
  }
  const bare = /^[0-9]{6}$/.exec(raw)
  if (bare === null || bare[0] === undefined) return null
  const code = bare[0]
  const market = code.startsWith('6') ? 'SH' : code.startsWith('0') || code.startsWith('3') ? 'SZ' : null
  return market === null ? null : `${code}.${market}`
}

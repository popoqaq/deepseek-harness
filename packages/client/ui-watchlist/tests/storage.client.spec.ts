import { describe, expect, it } from 'vitest'
import { readWatchlist, writeWatchlist, normalizeSymbol, WATCHLIST_STORAGE_KEY } from '../src/client/storage.ts'
import type { WatchlistItem } from '../src/client/types.ts'

class MemoryStorage {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
}

describe('watchlist storage', () => {
  it('round-trips entries and de-duplicates by symbol', () => {
    const storage = new MemoryStorage()
    const items: WatchlistItem[] = [
      { symbol: '600519.SH', name: '贵州茅台', addedAt: 1 },
      { symbol: '000001.SZ', name: '平安银行', addedAt: 2 },
    ]
    writeWatchlist(items, storage)
    expect(readWatchlist(storage)).toEqual(items)
    const duplicated = [...items, { symbol: '600519.SH', name: 'dup', addedAt: 3 }]
    writeWatchlist(duplicated, storage)
    expect(readWatchlist(storage)).toHaveLength(2)
  })

  it('degrades corrupt payloads to an empty list', () => {
    const storage = new MemoryStorage()
    storage.setItem(WATCHLIST_STORAGE_KEY, '{not-json')
    expect(readWatchlist(storage)).toEqual([])
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([{ symbol: 1 }]))
    expect(readWatchlist(storage)).toEqual([])
  })
})

describe('normalizeSymbol', () => {
  it('accepts bare, dotted, and prefixed A-share codes', () => {
    expect(normalizeSymbol('600519')).toBe('600519.SH')
    expect(normalizeSymbol('600519.SH')).toBe('600519.SH')
    expect(normalizeSymbol('sh600519')).toBe('600519.SH')
    expect(normalizeSymbol('000001')).toBe('000001.SZ')
    expect(normalizeSymbol('sz000001')).toBe('000001.SZ')
  })
  it('rejects unknown shapes and unsupported prefixes', () => {
    expect(normalizeSymbol('AAPL')).toBeNull()
    expect(normalizeSymbol('600519x')).toBeNull()
    expect(normalizeSymbol('930001')).toBeNull()
  })
})

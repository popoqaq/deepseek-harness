/**
 * Watchlist domain vocabulary shared by storage, UI, and the optional host
 * capability. Browser-local list of normalized A-share symbols with
 * best-effort quotes through `watchlistHost`; the list never depends on the
 * capability being present.
 * @module dsh-client-ui-watchlist/types
 */

/** One watchlist entry, stable shape for localStorage. */
export interface WatchlistItem {
  /** Normalized market code, e.g. `600519.SH` or `000001.SZ`. */
  readonly symbol: string
  /** Display name; falls back to the code when no quote service is configured. */
  readonly name: string
  /** Epoch millis when the entry was added. */
  readonly addedAt: number
}

/** One quote row the UI renders (nullable fields when the quote is unavailable). */
export interface QuoteSnapshot {
  readonly symbol: string
  readonly name: string
  /** Latest price, or null when unavailable. */
  readonly price: number | null
  /** Percent change vs previous close, or null. */
  readonly changePercent: number | null
  /** ISO time of the last successful refresh, or null. */
  readonly asOf: string | null
  /** Whether the retained values are stale (a refresh failed). */
  readonly stale: boolean
}

/** Lookup result shape a host capability returns. */
export interface WatchlistLookupItem {
  readonly symbol: string
  readonly name: string
}

/** The optional host capability providing symbol lookup and batch quotes. */
export interface WatchlistHost {
  /** Resolve a user query (code or name) into one normalized symbol. */
  lookup(query: string): Promise<WatchlistLookupItem[]>
  /** Batch quote request; the host bounds count and timeout. */
  quotes(symbols: readonly string[]): Promise<{ quotes: readonly QuoteSnapshot[]; asOf: string }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional watchlist host capability (market-data provider), when configured. */
    watchlistHost?: WatchlistHost
  }
}

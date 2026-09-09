/**
 * Session-header watchlist utility: a compact horizontal quote strip (with a
 * "+N" overflow summary) opening a management popover. Entries persist in
 * localStorage; quotes come from the optional `watchlistHost` capability and
 * refresh on a 15-second timer only while the capability and entries exist.
 * A failed refresh keeps the previous values flagged stale.
 * @module dsh-client-ui-watchlist/WatchlistUtility
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QuoteSnapshot, WatchlistHost, WatchlistItem } from './types.ts'
import { readWatchlist, writeWatchlist, normalizeSymbol } from './storage.ts'
import { NS, type WatchlistKey } from './locales.ts'
import css from './WatchlistUtility.module.css'

/** Quote refresh cadence while the strip is visible. */
const REFRESH_MS = 15_000
/** Chips shown before the overflow indicator. */
const MAX_CHIPS = 4

/** Injected face: the optional host quote capability, resolved at registration. */
export interface WatchlistUtilityInjected {
  host?: WatchlistHost
}

/** Full entry props for the session-header watchlist contribution. */
export type WatchlistUtilityProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<WatchlistUtilityInjected>

/** Fallback name for a strict code add when no lookup service exists. */
function codeNameOf(symbol: string): string {
  return symbol
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatPrice(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(2)
}

function trendClass(value: number | null): string {
  if (value === null) return css.flat ?? ''
  return (value > 0 ? css.up : value < 0 ? css.down : css.flat) ?? ''
}

/** Render the header chip and its management popover. */
export function WatchlistUtility({ host, t }: WatchlistUtilityProps): ReactNode {
  const [items, setItems] = useState<readonly WatchlistItem[]>(() => readWatchlist())
  const [quotes, setQuotes] = useState<ReadonlyMap<string, QuoteSnapshot>>(new Map())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<WatchlistKey | 'added' | 'invalidSymbol' | 'dup' | null>(null)
  const [noticeName, setNoticeName] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const lastAsOf = useRef<string | null>(null)
  const requestId = useRef(0)

  const symbols = items.map(item => item.symbol)
  const hostRef = host

  const refresh = useCallback(async (): Promise<void> => {
    if (hostRef === undefined || symbols.length === 0) return
    const id = ++requestId.current
    const previous = quotes
    try {
      const result = await hostRef.quotes(symbols)
      if (id !== requestId.current) return
      const next = new Map(quotes)
      for (const quote of result.quotes) next.set(quote.symbol, { ...quote, stale: false, asOf: quote.asOf ?? lastAsOf.current })
      lastAsOf.current = result.asOf ?? lastAsOf.current
      setQuotes(next)
      setStale(false)
    } catch {
      if (id !== requestId.current) return
      // Retain previous values, flagged stale (or null rows when none yet).
      const next = new Map(quotes)
      for (const symbol of symbols) {
        const entry = next.get(symbol)
        if (entry !== undefined) {
          next.set(symbol, { ...entry, stale: true, asOf: entry.asOf ?? null })
        }
      }
      setQuotes(next.size > 0 ? next : previous)
      setStale(true)
    }
  }, [hostRef, symbols.length, quotes]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (host === undefined) return
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, host === undefined]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: readonly WatchlistItem[]): void => {
    setItems(next)
    writeWatchlist(next)
  }

  const addCurrent = async (): Promise<void> => {
    const input = query.trim()
    if (input === '') return
    setBusy(true)
    setMessage(null)
    try {
      let symbol: string
      let name: string
      if (hostRef !== undefined) {
        const found = (await hostRef.lookup(input))[0]
        if (found === undefined) {
          setMessage('invalidSymbol')
          return
        }
        symbol = found.symbol
        name = found.name
      } else {
        const normalized = normalizeSymbol(input)
        if (normalized === null) {
          setMessage('invalidSymbol')
          return
        }
        symbol = normalized
        name = codeNameOf(normalized)
      }
      if (items.some(item => item.symbol === symbol)) {
        setMessage('dup')
        return
      }
      persist([...items, { symbol, name, addedAt: Date.now() }])
      setNoticeName(name)
      setMessage('added')
      setQuery('')
    } finally {
      setBusy(false)
    }
  }

  const remove = (symbol: string): void => {
    persist(items.filter(item => item.symbol !== symbol))
    const next = new Map(quotes)
    next.delete(symbol)
    setQuotes(next)
  }

  const quoteOf = (symbol: string): QuoteSnapshot | undefined => quotes.get(symbol)
  const visible = items.slice(0, MAX_CHIPS)
  const overflow = items.length - visible.length

  return (
    <div className={css.root}>
      <div className={css.chips}>
        {visible.map((item) => {
          const quote = quoteOf(item.symbol)
          const price = quote?.price ?? null
          const change = quote?.changePercent ?? null
          return (
            <button key={item.symbol} type="button" className={css.chip} onClick={() => setOpen(true)}>
              <span>{item.name}</span>
              {price !== null ? <span className={`${css.quote} ${trendClass(change)}`}>{formatPrice(price)}</span> : null}
              {change !== null ? <span className={trendClass(change)}>{formatPercent(change)}</span> : null}
              <span className={css.symbol}>{item.symbol}</span>
            </button>
          )
        })}
        {overflow > 0 ? (
          <span className={css.symbol} title={items.slice(MAX_CHIPS).map(item => item.name).join('、')}>+{overflow}</span>
        ) : null}
      </div>
      {open ? (
        <div className={css.popover}>
          <div className={css.header}>
            <span>{t('title')}</span>
            <button type="button" onClick={() => { setOpen(false); setMessage(null) }} aria-label={t('title')}>×</button>
          </div>
          <div className={css.addRow}>
            <input
              className={css.input}
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void addCurrent() }}
              placeholder={t('addPlaceholder')}
              aria-label={t('addPlaceholder')}
            />
            <button type="button" disabled={busy} onClick={() => void addCurrent()}>{t('add')}</button>
          </div>
          {host === undefined ? <div className={css.msg}>{t('quoteUnavailable')}</div> : null}
          {items.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
          <div className={css.list}>
            {items.map((item) => {
              const quote = quoteOf(item.symbol)
              const change = quote?.changePercent ?? null
              return (
                <div key={item.symbol} className={css.row}>
                  <span>
                    <span className={css.symbol}>{item.symbol}</span> {item.name}
                  </span>
                  <span className={`${css.quote} ${trendClass(change)}`}>
                    {formatPrice(quote?.price ?? null)} {formatPercent(change)}
                  </span>
                  <button type="button" aria-label={t('remove')} onClick={() => remove(item.symbol)}>{t('remove')}</button>
                </div>
              )
            })}
          </div>
          <div className={css.msg}>
            {host !== undefined ? (
              <>
                <button type="button" onClick={() => void refresh()}>{t('refresh')}</button>
                {lastAsOf.current !== null ? ` ${t('lastUpdated').replace('{time}', lastAsOf.current)}` : ''}
                {stale ? ` ${t('stale')}` : ''}
              </>
            ) : null}
            {message !== null ? ` ${t(message).replace('{name}', noticeName ?? '')}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}

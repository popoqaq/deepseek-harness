/**
 * Browser half of the watchlist: one Session-header utility chip strip with a
 * management popover. The list is browser-local; quotes flow through the
 * optional host `watchlistHost` capability when a deployment configures one.
 * @module dsh-client-ui-watchlist/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WatchlistHost } from './types.ts'
import { WatchlistUtility, type WatchlistUtilityInjected } from './WatchlistUtility.tsx'
import { en, NS, zh, type WatchlistKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header watchlist copy. */
    'watchlist': WatchlistKey
  }
}

export type { WatchlistUtilityInjected, WatchlistUtilityProps } from './WatchlistUtility.tsx'
export type { WatchlistItem, QuoteSnapshot, WatchlistHost, WatchlistLookupItem } from './types.ts'
export { readWatchlist, writeWatchlist, normalizeSymbol, WATCHLIST_STORAGE_KEY } from './storage.ts'

/** Required services for locale registration and the header-slot contribution. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header watchlist
 * utility. The optional host capability is read at registration time.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const host: WatchlistHost | undefined = ctx.watchlistHost
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'watchlist: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'watchlist',
    order: 20,
    locale: NS,
    inject: (): WatchlistUtilityInjected => (host === undefined ? {} : { host }),
  }, WatchlistUtility))
}

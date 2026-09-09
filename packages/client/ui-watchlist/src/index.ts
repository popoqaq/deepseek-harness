/**
 * Watchlist browsing surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. Quotes arrive through the optional host
 * `watchlistHost` capability; without it the watchlist is manage-only.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

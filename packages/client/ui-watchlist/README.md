# dsh-client-ui-watchlist
English | [中文](README.zh.md)

Web Session-header stock watchlist utility: a compact quote strip that opens a
management popover. Entries persist in the browser (localStorage,
`dsh.watchlist.v1`); quotes arrive through the optional host
`watchlistHost` capability when a deployment configures a market-data
provider. Without the capability the watchlist stays fully manageable — add
by 6-digit A-share code (name falls back to the code) — and no prices are
fabricated.

See `docs/superpowers/specs/2026-08-19-watchlist-plugin-design.md` for the
design (Host Remote + adapter contract is the remaining host-side follow-up).

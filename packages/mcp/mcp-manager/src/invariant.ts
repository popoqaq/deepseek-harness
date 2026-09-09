/** Package-owned invariant companion for the persisted MCP manager. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'mcp-manager-invariant'
/** Service required before the companion can register package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the manager's authoritative desired state and the
 * asynchronous Loader projection are intentionally observed through its
 * Remote snapshot and status events rather than a second invariant cache.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

/** Package-owned invariant companion for the MCP manager Web plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'client-ui-mcp-manager-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/** No runtime invariant: the Host manager Remote is the authoritative view. */
const install: InvariantInstaller = () => {}

/** Register the package companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

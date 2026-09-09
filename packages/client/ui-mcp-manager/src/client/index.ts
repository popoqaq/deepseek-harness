/** Browser half of the MCP management settings tab. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { McpManagerSettingsTab, type McpManagerSettingsTabInjected, type McpManagerRemote } from './McpManagerSettingsTab.tsx'
import { en, zh, type McpManagerLocaleKey } from './locales.ts'

export type { McpManagerSettingsTabInjected, McpManagerSettingsTabProps } from './McpManagerSettingsTab.tsx'
export type { McpManagerLocaleKey } from './locales.ts'

const NS = 'settings.mcpManager'

/** Required client services for the MCP Remote, settings slot, and localized copy. */
export const inject = ['slots', 'remote', 'remote.mcpManager', 'locale']

/** Resolve a Remote result or raise its stable diagnostic for the settings UI. */
async function remoteValue<T>(operation: string, response: Promise<RemoteResult<T>>): Promise<T> {
  const result = await response
  if (!result.ok) throw new Error(`mcpManager.${operation} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Install the MCP manager locale and Settings tab contribution. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp-manager: dictionaries')
  const remote = ctx.remote.mcpManager
  const manager: McpManagerRemote = {
    list: () => remoteValue('list', remote.list()),
    create: request => remoteValue('create', remote.create(request)),
    update: request => remoteValue('update', remote.update(request)),
    deleteServer: request => remoteValue('deleteServer', remote.deleteServer(request)),
    setEnabled: request => remoteValue('setEnabled', remote.setEnabled(request)),
    reconnect: request => remoteValue('reconnect', remote.reconnect(request)),
    probe: request => remoteValue('probe', remote.probe(request)),
  }
  const t = ctx.locale.bind(NS)
  const onChanged = (listener: () => void): (() => void) =>
    ctx.remote.$on('mcp-manager/changed', () => { listener() })
  const injected = (): McpManagerSettingsTabInjected => ({ manager, onChanged })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcp',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpManagerSettingsTab))
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP manager settings copy. */
    'settings.mcpManager': McpManagerLocaleKey
  }
}

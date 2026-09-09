import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  McpServerDraft,
  McpServerId,
  McpServerSnapshot,
  McpServerViewConfig,
  McpServerState,
} from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpManagerLocaleKey } from './locales.ts'
import css from './McpManagerSettingsTab.module.css'

/** Unwrapped business-facing adapter derived from the generated Remote face. */
type UnwrapMethod<T> = T extends (...args: infer Args) => Promise<RemoteResult<infer Value>>
  ? (...args: Args) => Promise<Value>
  : never
export type McpManagerRemote = {
  [Key in keyof ClientRemote['mcpManager']]: UnwrapMethod<ClientRemote['mcpManager'][Key]>
}

/** Fixed request marker that asks the Host to retain an already-configured literal value. */
const MASKED_VALUE = '[configured]'

/** Injected face registered by the browser plugin. */
export interface McpManagerSettingsTabInjected {
  manager: McpManagerRemote
  onChanged: (listener: () => void) => () => void
}

export type McpManagerSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.mcpManager'>
  & InjectFace<McpManagerSettingsTabInjected>

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: McpServerSnapshot }

interface FormState {
  label: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  cwd: string
  url: string
  env: string
  headers: string
  credentialEnv: string
  credentialHeaders: string
  toolCallTimeoutMs: string
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  label: '', serverName: '', transport: 'stdio', command: '', args: '[]', cwd: '', url: '',
  env: '{}', headers: '{}', credentialEnv: '{}', credentialHeaders: '{}', toolCallTimeoutMs: '60000', enabled: true,
}

const STATE_KEYS: Record<McpServerState, McpManagerLocaleKey> = {
  disabled: 'disabled', connecting: 'connecting', connected: 'connected', reconnecting: 'reconnecting',
  blocked: 'blocked', failed: 'failed', exhausted: 'exhausted', stopped: 'stopped',
}

function jsonObject(text: string): Record<string, string> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    if (!Object.values(value).every((entry: unknown) => typeof entry === 'string')) return undefined
    return value as Record<string, string>
  } catch {
    return undefined
  }
}

function jsonArray(text: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : undefined
  } catch {
    return undefined
  }
}

function formFromRecord(record: McpServerViewConfig): FormState {
  const maskedValues = (values: Record<string, { configured: boolean }>): Record<string, string> =>
    Object.fromEntries(Object.entries(values).map(([name, state]) => [name, state.configured ? MASKED_VALUE : '']))
  return {
    label: record.label ?? '', serverName: record.serverName, transport: record.transport,
    command: record.transport === 'stdio' ? record.command : '', args: record.transport === 'stdio' ? JSON.stringify(record.args) : '[]',
    cwd: record.transport === 'stdio' ? record.cwd : '', url: record.transport === 'streamable-http' ? record.url : '',
    env: JSON.stringify(maskedValues(record.env)), headers: JSON.stringify(record.transport === 'streamable-http' ? maskedValues(record.headers) : {}),
    credentialEnv: JSON.stringify(record.credentialEnv), credentialHeaders: JSON.stringify(record.transport === 'streamable-http' ? record.credentialHeaders : {}),
    toolCallTimeoutMs: String(record.toolCallTimeoutMs), enabled: record.enabled,
  }
}

function draftFromForm(form: FormState): McpServerDraft | undefined {
  const env = jsonObject(form.env)
  const headers = jsonObject(form.headers)
  const credentialEnv = jsonObject(form.credentialEnv)
  const credentialHeaders = jsonObject(form.credentialHeaders)
  const args = jsonArray(form.args)
  const timeout = Number(form.toolCallTimeoutMs)
  if (
    env === undefined || headers === undefined || credentialEnv === undefined || credentialHeaders === undefined
    || args === undefined || !Number.isFinite(timeout)
  ) return undefined
  const reconnect = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }
  if (form.transport === 'stdio') {
    return {
      ...(form.label.trim() ? { label: form.label.trim() } : {}), serverName: form.serverName.trim(), enabled: form.enabled, transport: 'stdio',
      command: form.command.trim(), args, cwd: form.cwd, env, credentialEnv,
      toolCallTimeoutMs: timeout, failOnStartupError: false, reconnect,
    }
  }
  return {
    ...(form.label.trim() ? { label: form.label.trim() } : {}), serverName: form.serverName.trim(), enabled: form.enabled, transport: 'streamable-http',
    url: form.url.trim(), headers, credentialHeaders, env, credentialEnv, toolCallTimeoutMs: timeout, failOnStartupError: false, reconnect,
  }
}

/** Render the interactive MCP management tab. */
export function McpManagerSettingsTab({ manager, onChanged, t }: McpManagerSettingsTabProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [editing, setEditing] = useState<McpServerId | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState(0)

  const reload = (): void => setRequest(value => value + 1)
  useEffect(() => onChanged(reload), [onChanged])
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    void manager.list().then((snapshot) => { if (live) setState({ status: 'ready', snapshot }) }, () => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [manager, request])

  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
  const recoverFromConflict = async (error: unknown): Promise<void> => {
    const message = errorText(error)
    setNotice(message)
    if (!message.includes('MCP_CONFIG_CONFLICT')) return
    try {
      setState({ status: 'ready', snapshot: await manager.list() })
    } catch {
      // Keep the original conflict visible when the refresh itself fails.
    }
  }
  const runMutation = async (operation: () => Promise<McpServerSnapshot>): Promise<void> => {
    setBusy(true); setNotice(undefined)
    try {
      setState({ status: 'ready', snapshot: await operation() })
    } catch (error) {
      await recoverFromConflict(error)
    } finally { setBusy(false) }
  }
  const submit = async (): Promise<void> => {
    const draft = draftFromForm(form)
    if (draft === undefined) { setNotice(t('invalidJson')); return }
    setBusy(true); setNotice(undefined)
    try {
      const revision = snapshot?.revision
      if (editing === null) throw new Error('MCP settings can only edit an Agent-installed server')
      const next = await manager.update({
        id: editing,
        patch: draft,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      setState({ status: 'ready', snapshot: next }); setEditing(null); setForm(EMPTY_FORM); setNotice(t('saved'))
    } catch (error) {
      await recoverFromConflict(error)
    } finally { setBusy(false) }
  }

  const edit = (record: McpServerViewConfig): void => { setEditing(record.id); setForm(formFromRecord(record)); setNotice(undefined) }
  const cancel = (): void => { setEditing(null); setForm(EMPTY_FORM); setNotice(undefined) }

  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'error') return <div className={css.status}><p role="alert">{t('error')}</p><button type="button" onClick={reload}>{t('retry')}</button></div>

  return (
    <div className={css.root} aria-busy={busy}>
      <div className={css.toolbar}>
        <h3>{t('tab')}</h3>
      </div>
      <p className={css.status}>{t('agentInstallHint')}</p>
      {notice !== undefined ? <p className={css.notice} role="status">{notice}</p> : null}
      {snapshot?.servers.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      <ul className={css.list}>
        {snapshot?.servers.map(({ config, state: serverState, toolCount, error }) => (
          <li className={css.row} key={config.id}>
            <div className={css.rowMain}>
              <strong>{config.label || config.serverName}</strong>
              <code>{config.serverName}</code>
              <span data-state={serverState}>{t(STATE_KEYS[serverState])}</span>
              <span>{toolCount} {t('tools')}</span>
            </div>
            {error !== undefined ? <p className={css.error}>{error}</p> : null}
            <div className={css.actions}>
              <button type="button" disabled={busy} onClick={() => void runMutation(() => manager.setEnabled({ id: config.id, enabled: !config.enabled, expectedRevision: snapshot.revision }))}>{config.enabled ? t('disable') : t('enable')}</button>
              <button type="button" disabled={busy} onClick={() => edit(config)}>{t('edit')}</button>
              <button type="button" disabled={busy} onClick={() => void runMutation(() => manager.reconnect({ id: config.id, expectedRevision: snapshot.revision }))}>{t('reconnect')}</button>
              <button type="button" disabled={busy} onClick={() => { if (globalThis.confirm(t('confirmRemove'))) void runMutation(() => manager.deleteServer({ id: config.id, expectedRevision: snapshot.revision })) }}>{t('remove')}</button>
            </div>
          </li>
        ))}
      </ul>
      {editing !== null ? (
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <h4>{t('edit')}</h4>
          <label>{t('label')}<input value={form.label} onChange={event => setForm({ ...form, label: event.currentTarget.value })} /></label>
          <label>{t('serverName')}<input required pattern="[A-Za-z0-9_-]{1,32}" value={form.serverName} onChange={event => setForm({ ...form, serverName: event.currentTarget.value })} /><small>{t('namespaceWarning')}</small></label>
          <label>{t('transport')}<select value={form.transport} onChange={event => setForm({ ...form, transport: event.currentTarget.value as FormState['transport'] })}><option value="stdio">{t('stdio')}</option><option value="streamable-http">{t('http')}</option></select></label>
          {form.transport === 'stdio' ? <><label>{t('command')}<input required value={form.command} onChange={event => setForm({ ...form, command: event.currentTarget.value })} /></label><label>{t('args')}<textarea value={form.args} onChange={event => setForm({ ...form, args: event.currentTarget.value })} /></label><label>{t('cwd')}<input value={form.cwd} onChange={event => setForm({ ...form, cwd: event.currentTarget.value })} /></label></> : <label>{t('url')}<input required type="url" value={form.url} onChange={event => setForm({ ...form, url: event.currentTarget.value })} /></label>}
          <label>{t('env')}<textarea value={form.env} onChange={event => setForm({ ...form, env: event.currentTarget.value })} /></label>
          {form.transport === 'streamable-http' ? <label>{t('headers')}<textarea value={form.headers} onChange={event => setForm({ ...form, headers: event.currentTarget.value })} /></label> : null}
          <label>{t('credentialEnv')}<textarea value={form.credentialEnv} onChange={event => setForm({ ...form, credentialEnv: event.currentTarget.value })} /></label>
          {form.transport === 'streamable-http' ? <label>{t('credentialHeaders')}<textarea value={form.credentialHeaders} onChange={event => setForm({ ...form, credentialHeaders: event.currentTarget.value })} /></label> : null}
          <label>{t('toolCallTimeoutMs')}<input type="number" min="1" value={form.toolCallTimeoutMs} onChange={event => setForm({ ...form, toolCallTimeoutMs: event.currentTarget.value })} /></label>
          <label className={css.check}><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.currentTarget.checked })} />{t('enabled')}</label>
          <div className={css.actions}><button type="submit" disabled={busy}>{t('save')}</button><button type="button" onClick={cancel}>{t('cancel')}</button><button type="button" disabled={busy} onClick={() => { const draft = draftFromForm(form); if (draft === undefined) setNotice(t('invalidJson')); else { setBusy(true); void manager.probe({ config: draft }).then(result => setNotice(result.ok ? t('probed').replace('{count}', String(result.toolCount ?? 0)) : result.message ?? t('error'))).finally(() => setBusy(false)) } }}>{t('probe')}</button></div>
        </form>
      ) : null}
    </div>
  )
}

/**
 * Browser skin pack: registers the fixed skins and one custom wallpaper skin,
 * restores the persisted selection, and contributes the settings row.
 *
 * The custom skin deliberately has no editable background/surface/accent
 * colors. It owns named local wallpaper combinations; each combination has
 * one sidebar image and one main conversation image.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the theme service's Context merge (ctx.theme, theme/change).
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the settings section's SlotMap merge ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SkinsRowInjected } from './SkinsRow.tsx'
import { SkinsRow } from './SkinsRow.tsx'
import { createSkinsRowStore } from './store.ts'
import { isSkinId, SKINS } from './skins.ts'
import {
  CUSTOM_ID, customTokens, getActiveWallpaper, loadCustomFields, loadWallpaperCollection, saveCustomFields,
  saveWallpaperCollection, type CustomFields, type CustomWallpapers, type WallpaperCollection,
} from './custom.ts'
import { en, zh, type SkinsKey } from './locales.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.skins'

/** localStorage key holding the last skin the user picked. */
export const STORAGE_KEY = 'ui-skins.preference'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skins settings row's copy. */
    'settings.skins': SkinsKey
  }
}

/** Required services: theme registry plus slots/locale for the settings row. */
export const inject = ['theme', 'slots', 'locale']

type WallpaperSurface = HTMLElement

type WallpaperTargets = {
  frame: WallpaperSurface | null
  sidebarColumn: WallpaperSurface | null
  sidebarRoot: WallpaperSurface | null
  mainContent: WallpaperSurface | null
  composerSeat: WallpaperSurface | null
}

/** Find the full-viewport AppFrame without depending on its hashed CSS class. */
function findFrame(): WallpaperSurface | null {
  for (const el of document.querySelectorAll<HTMLElement>('div')) {
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (Math.abs(rect.width - window.innerWidth) < 2
      && Math.abs(rect.height - window.innerHeight) < 2
      && cs.overflow === 'hidden'
      && cs.position === 'relative') return el
  }
  return null
}

/**
 * Find both sidebar layers. The layout column covers SidebarRoot, so it must
 * become transparent when the frame's main wallpaper is exposed; the root may
 * therefore already be transparent when a later override is uploaded.
 */
function findSidebarTargets(frame: WallpaperSurface | null): Pick<WallpaperTargets, 'sidebarColumn' | 'sidebarRoot'> {
  if (frame === null) return { sidebarColumn: null, sidebarRoot: null }
  const frameRect = frame.getBoundingClientRect()
  const sidebarColumn = [...frame.children].find((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false
    const rect = child.getBoundingClientRect()
    return Math.abs(rect.left - frameRect.left) < 2
      && Math.abs(rect.top - frameRect.top) < 2
      && Math.abs(rect.height - frameRect.height) < 2
      && rect.width > 40
      && rect.width < frameRect.width * 0.6
  }) ?? null
  const candidates = [...frame.querySelectorAll<HTMLElement>('div')].filter((el) => {
    const rect = el.getBoundingClientRect()
    // Do not require an opaque background here: with a main-only wallpaper,
    // both the column and SidebarRoot are intentionally transparent before a
    // later sidebar upload asks us to find the same root again.
    return Math.abs(rect.left - frameRect.left) < 2
      && Math.abs(rect.top - frameRect.top) < 2
      && Math.abs(rect.height - frameRect.height) < 2
      && rect.width > 40
      && rect.width < frameRect.width * 0.6
  })
  return { sidebarColumn, sidebarRoot: candidates.at(-1) ?? null }
}

/** The resident conversation root is the main-content surface. */
function findMainContent(): WallpaperSurface | null {
  return document.querySelector<WallpaperSurface>('[data-phase]')
}

/** Find all surfaces used by the two-layer wallpaper composition. */
function findWallpaperTargets(): WallpaperTargets {
  const frame = findFrame()
  return {
    frame,
    ...findSidebarTargets(frame),
    mainContent: findMainContent(),
    composerSeat: document.querySelector<WallpaperSurface>('[data-composer-seat]'),
  }
}

/** Clear only inline background properties owned by this plugin. */
function clearSurface(surface: WallpaperSurface | null): void {
  if (surface === null) return
  surface.style.backgroundImage = ''
  surface.style.backgroundSize = ''
  surface.style.backgroundPosition = ''
  surface.style.backgroundRepeat = ''
}

/** Paint a single surface with a readable scheme-aware scrim. */
function paintSurface(surface: WallpaperSurface | null, dataUrl: string | null, scheme: 'dark' | 'light'): void {
  if (surface === null) return
  clearSurface(surface)
  if (dataUrl === null) return
  const scrim = scheme === 'dark' ? 'rgba(0, 0, 0, 0.62)' : 'rgba(255, 255, 255, 0.55)'
  surface.style.backgroundImage = `linear-gradient(${scrim}, ${scrim}), url("${dataUrl}")`
  surface.style.backgroundSize = 'cover, cover'
  surface.style.backgroundPosition = 'center, center'
  surface.style.backgroundRepeat = 'no-repeat, no-repeat'
}

/** Attribute identifying the plugin-owned sidebar gradient. */
const SIDEBAR_BLEND_ATTR = 'data-ui-skins-sidebar-blend'

/** Install the sidebar-only blur/gradient rule in a plugin-owned style element. */
function installSidebarBlendStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined' || document.head === null) return null
  document.querySelector('style[data-ui-skins="sidebar-blend"]')?.remove()
  document.querySelector('style[data-ui-skins="sidebar-paint"]')?.remove()
  document.querySelector('[data-ui-skins-sidebar-paint]')?.remove()
  document.querySelector('[data-ui-skins-main-blend]')?.remove()
  const style = document.createElement('style')
  style.dataset.uiSkins = 'sidebar-blend'
  style.textContent = `
    [${SIDEBAR_BLEND_ATTR}] {
      position: absolute;
      top: -7%;
      height: 114%;
      z-index: 2;
      pointer-events: none;
      overflow: visible;
      background-image: var(--ui-skins-sidebar-blend-image);
      background-position: center;
      background-repeat: repeat-y;
      background-size: cover;
      filter: blur(22px) saturate(1.04);
      opacity: 0.38;
      mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.84) 0%, rgba(0, 0, 0, 0.66) 30%, rgba(0, 0, 0, 0.3) 72%, transparent 100%);
      -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.84) 0%, rgba(0, 0, 0, 0.66) 30%, rgba(0, 0, 0, 0.3) 72%, transparent 100%);
    }
  `
  document.head.appendChild(style)
  return style
}

/** Create/update the sidebar-only gradient at the split. */
function updateSidebarBlendOverlay(
  frame: WallpaperSurface | null,
  sidebarColumn: WallpaperSurface | null,
  main: string | null,
  sidebar: string | null,
): void {
  const current = document.querySelector<HTMLElement>(`[${SIDEBAR_BLEND_ATTR}]`)
  const obsoleteMain = document.querySelector<HTMLElement>('[data-ui-skins-main-blend]')
  obsoleteMain?.remove()
  // A sidebar gradient needs both images so it can fade into the main backdrop.
  if (frame === null || sidebarColumn === null || main === null || sidebar === null) {
    current?.remove()
    return
  }
  const overlay = current ?? document.createElement('div')
  if (current === null) {
    overlay.setAttribute(SIDEBAR_BLEND_ATTR, '')
    frame.appendChild(overlay)
  }
  const frameRect = frame.getBoundingClientRect()
  const sidebarRect = sidebarColumn.getBoundingClientRect()
  const split = Math.max(0, sidebarRect.right - frameRect.left)
  overlay.style.left = `${split}px`
  overlay.style.top = '-7%'
  overlay.style.width = `${sidebarRect.width}px`
  overlay.style.height = '114%'
  overlay.style.setProperty('--ui-skins-sidebar-blend-image', `url("${sidebar}")`)
}

/**
 * Compose the wallpapers as layers: main content paints the full AppFrame;
 * transparent shells expose that image; a sidebar image, when present, is
 * painted only on top of the sidebar shell, with a static sidebar-only blur
 * blend extending toward the main content at the boundary.
 */
function applyCustomWallpapers(wallpapers: CustomWallpapers | null, scheme: 'dark' | 'light'): void {
  const targets = findWallpaperTargets()
  const main = wallpapers?.main ?? null
  const sidebar = wallpapers?.sidebar ?? null
  const hasFrameBackdrop = main !== null
  const hasSidebarOverride = sidebar !== null

  paintSurface(targets.frame, main, scheme)
  paintSurface(targets.sidebarRoot, sidebar, scheme)
  clearSurface(targets.mainContent)

  if (targets.mainContent !== null) {
    targets.mainContent.style.backgroundColor = hasFrameBackdrop ? 'transparent' : ''
  }
  // ConversationRoot's own composer mask is opaque on dark themes. When the
  // main wallpaper is active, let the frame backdrop continue behind the
  // composer; clearing this inline value restores the built-in mask later.
  if (targets.composerSeat !== null) {
    targets.composerSeat.style.background = hasFrameBackdrop ? 'transparent' : ''
  }
  if (targets.sidebarColumn !== null) {
    targets.sidebarColumn.style.backgroundColor = hasFrameBackdrop || hasSidebarOverride ? 'transparent' : ''
  }
  if (targets.sidebarRoot !== null) {
    targets.sidebarRoot.style.backgroundColor = hasFrameBackdrop || hasSidebarOverride ? 'transparent' : ''
  }
  updateSidebarBlendOverlay(targets.frame, targets.sidebarColumn, main, sidebar)
}

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  for (const skin of SKINS) ctx.theme.register(skin)

  let customDisposer: (() => void) | undefined
  const registerCustom = (fields: CustomFields): void => {
    customDisposer?.()
    customDisposer = ctx.theme.register({
      id: CUSTOM_ID,
      colorScheme: fields.scheme,
      tokens: customTokens(fields),
    })
  }
  registerCustom(loadCustomFields())
  ctx.effect(() => () => { customDisposer?.() }, 'ui-skins: custom theme disposer')

  const sidebarBlendStyle = installSidebarBlendStyle()
  ctx.effect(() => () => {
    sidebarBlendStyle?.remove()
    document.querySelector(`[${SIDEBAR_BLEND_ATTR}]`)?.remove()
    document.querySelector('[data-ui-skins-main-blend]')?.remove()
  }, 'ui-skins: sidebar blend cleanup')

  // Restore the custom/fixed selection after the built-in settings preference
  // has adopted during boot.
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const restore = (): void => {
    if (saved !== null && (saved === CUSTOM_ID || isSkinId(saved))) ctx.theme.setTheme(saved)
  }
  ctx.effect(() => {
    const t1 = setTimeout(restore, 0)
    const t2 = setTimeout(restore, 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, 'ui-skins: restore timers')

  // Wallpaper exists only on the custom skin. Switching to any fixed skin
  // removes both images; switching back restores both independently.
  const applyWallpaperForActive = (snapshot: ThemeSnapshot): void => {
    const active = snapshot.active
    applyCustomWallpapers(
      active.id === CUSTOM_ID ? getActiveWallpaper(loadWallpaperCollection()) : null,
      active.colorScheme,
    )
  }
  ctx.on('theme/change', applyWallpaperForActive)
  applyWallpaperForActive(ctx.theme.getTheme())

  // Conversation switching can replace `[data-phase]` with a fresh root. The
  // old inline transparency then disappears with the old node, so observe
  // structural DOM changes and repaint once on the next frame. Also observe
  // the live frame/sidebar sizes so the blend left edge follows collapse.
  ctx.effect(() => {
    const documentRoot = document.documentElement
    if (documentRoot === null) return () => {}
    let frame: number | null = null
    const repaint = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        applyWallpaperForActive(ctx.theme.getTheme())
      })
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(repaint)
    const observeLayout = (): void => {
      if (resizeObserver === null) return
      const targets = findWallpaperTargets()
      if (targets.frame !== null) resizeObserver.observe(targets.frame)
      if (targets.sidebarColumn !== null) resizeObserver.observe(targets.sidebarColumn)
    }
    observeLayout()
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => { observeLayout(); repaint() })
    observer?.observe(documentRoot, { childList: true, subtree: true })
    return () => {
      observer?.disconnect()
      resizeObserver?.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, 'ui-skins: repaint wallpaper after DOM replacement/resize')
  ctx.effect(() => () => applyCustomWallpapers(null, 'dark'), 'ui-skins: wallpaper cleanup')

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-skins: row dictionaries')

  const store = createSkinsRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot.preference, snapshot.revision)
  }
  ctx.on('theme/change', sync)
  const injected = (actions: BoundActions<typeof store>): SkinsRowInjected => {
    bound = actions
    sync(ctx.theme.getTheme())
    return {
      setSkin: (id: string) => {
        ctx.theme.setTheme(id)
        localStorage.setItem(STORAGE_KEY, id)
      },
      updateCustom: (fields: CustomFields) => {
        saveCustomFields(fields)
        registerCustom(fields)
        ctx.theme.setTheme(CUSTOM_ID)
      },
      updateCustomWallpapers: (collection: WallpaperCollection) => {
        saveWallpaperCollection(collection)
        applyWallpaperForActive(ctx.theme.getTheme())
      },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'skins',
    order: 11,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, SkinsRow))
}

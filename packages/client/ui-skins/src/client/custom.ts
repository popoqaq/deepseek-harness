/**
 * Custom-wallpaper model: the custom skin keeps only a light/dark text mode;
 * its visual customization is a selectable collection of wallpaper
 * combinations. Every combination has one sidebar image and one main image.
 */

/** User-selectable text/scrim mode for the custom wallpaper skin. */
export interface CustomFields {
  /** Base palette used for readable text and the wallpaper scrim. */
  scheme: 'dark' | 'light'
}

/** The theme id of the user-defined wallpaper skin. */
export const CUSTOM_ID = 'custom'

/** Fallback custom-wallpaper settings. */
export const DEFAULT_CUSTOM_FIELDS: CustomFields = Object.freeze({
  scheme: 'dark',
})

const STORAGE_KEY = 'ui-skins.custom'

/** Derive the custom theme override map; wallpaper supplies the visual layer. */
export function customTokens(_fields: CustomFields): Record<string, string> {
  return {}
}

/** Read the persisted custom-wallpaper text mode. */
export function loadCustomFields(): CustomFields {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CUSTOM_FIELDS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_CUSTOM_FIELDS }
    const parsed = JSON.parse(raw) as Partial<CustomFields>
    return { scheme: parsed.scheme === 'light' ? 'light' : 'dark' }
  } catch {
    return { ...DEFAULT_CUSTOM_FIELDS }
  }
}

/** Persist the custom-wallpaper text mode. */
export function saveCustomFields(fields: CustomFields): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
}

/** One named pair of sidebar/main wallpapers. */
export interface WallpaperCombination {
  id: string
  name: string
  sidebar: string | null
  main: string | null
}

/** Persisted collection of named wallpaper combinations. */
export interface WallpaperCollection {
  activeId: string
  combinations: WallpaperCombination[]
}

/** The currently selected pair used by the renderer. */
export interface CustomWallpapers {
  sidebar: string | null
  main: string | null
}

/** Default empty pair. */
export const EMPTY_CUSTOM_WALLPAPERS: CustomWallpapers = Object.freeze({
  sidebar: null,
  main: null,
})

const WALLPAPERS_KEY = 'ui-skins.custom-wallpapers'
const LEGACY_MAP_KEY = 'ui-skins.wallpapers'
const LEGACY_SINGLE_KEY = 'ui-skins.wallpaper'
const DEFAULT_COMBINATION_ID = 'default'
const DEFAULT_COMBINATION_NAME = '默认组合'

/** Cryptographically random suffix for locally minted ids (no secure-context dependency). */
function randomSuffix(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Create a new empty combination with a stable local id. */
export function createWallpaperCombination(name: string): WallpaperCombination {
  return { id: `wallpaper-${randomSuffix()}`, name, sidebar: null, main: null }
}

/** Return the active pair, falling back safely when a stored id is stale. */
export function getActiveWallpaper(collection: WallpaperCollection): CustomWallpapers {
  const active = collection.combinations.find(item => item.id === collection.activeId)
    ?? collection.combinations[0]
  return active === undefined
    ? { ...EMPTY_CUSTOM_WALLPAPERS }
    : { sidebar: active.sidebar, main: active.main }
}

function normalizeCombination(value: unknown, index: number): WallpaperCombination | null {
  if (value === null || typeof value !== 'object') return null
  const parsed = value as Partial<WallpaperCombination>
  if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null
  return {
    id: parsed.id,
    name: parsed.name.trim() || `${DEFAULT_COMBINATION_NAME} ${index + 1}`,
    sidebar: typeof parsed.sidebar === 'string' ? parsed.sidebar : null,
    main: typeof parsed.main === 'string' ? parsed.main : null,
  }
}

function normalizeCollection(value: unknown): WallpaperCollection | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const parsed = value as Partial<WallpaperCollection>
  if (!Array.isArray(parsed.combinations)) return undefined
  const combinations = parsed.combinations
    .map((item, index) => normalizeCombination(item, index))
    .filter((item): item is WallpaperCombination => item !== null)
  const first = combinations[0]
  if (first === undefined) return undefined
  const activeId = typeof parsed.activeId === 'string' && combinations.some(item => item.id === parsed.activeId)
    ? parsed.activeId
    : first.id
  return { activeId, combinations }
}

/**
 * Read named wallpaper combinations. The old single pair and old per-skin map
 * migrate into one default combination so existing images remain available.
 */
export function loadWallpaperCollection(): WallpaperCollection {
  if (typeof localStorage === 'undefined') {
    return { activeId: DEFAULT_COMBINATION_ID, combinations: [{
      id: DEFAULT_COMBINATION_ID, name: DEFAULT_COMBINATION_NAME, sidebar: null, main: null,
    }] }
  }

  const raw = localStorage.getItem(WALLPAPERS_KEY)
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown
      const collection = normalizeCollection(parsed)
      if (collection !== undefined) return collection

      // Migration from the previous format: { sidebar, main }.
      if (parsed !== null && typeof parsed === 'object') {
        const pair = parsed as Partial<CustomWallpapers>
        if ('sidebar' in pair || 'main' in pair) {
          const migrated = {
            activeId: DEFAULT_COMBINATION_ID,
            combinations: [{
              id: DEFAULT_COMBINATION_ID,
              name: DEFAULT_COMBINATION_NAME,
              sidebar: typeof pair.sidebar === 'string' ? pair.sidebar : null,
              main: typeof pair.main === 'string' ? pair.main : null,
            }],
          }
          localStorage.setItem(WALLPAPERS_KEY, JSON.stringify(migrated))
          return migrated
        }
      }
    } catch {
      // Fall through to the older keys below.
    }
  }

  let legacyMain: string | null = localStorage.getItem(LEGACY_SINGLE_KEY)
  const legacySidebar: string | null = null
  if (legacyMain === null) {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_MAP_KEY) ?? 'null') as Record<string, unknown> | null
      const candidate = parsed?.[CUSTOM_ID]
      if (typeof candidate === 'string') legacyMain = candidate
    } catch {
      // Ignore malformed legacy storage.
    }
  }
  const migrated: WallpaperCollection = {
    activeId: DEFAULT_COMBINATION_ID,
    combinations: [{
      id: DEFAULT_COMBINATION_ID,
      name: DEFAULT_COMBINATION_NAME,
      sidebar: legacySidebar,
      main: legacyMain,
    }],
  }
  if (legacyMain !== null || legacySidebar !== null) {
    localStorage.setItem(WALLPAPERS_KEY, JSON.stringify(migrated))
    localStorage.removeItem(LEGACY_SINGLE_KEY)
    localStorage.removeItem(LEGACY_MAP_KEY)
  }
  return migrated
}

/** Persist the complete named wallpaper collection. */
export function saveWallpaperCollection(collection: WallpaperCollection): void {
  localStorage.setItem(WALLPAPERS_KEY, JSON.stringify(collection))
}

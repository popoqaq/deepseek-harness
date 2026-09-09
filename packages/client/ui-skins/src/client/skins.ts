/**
 * Skin catalog: each skin is a ThemeDefinition — alias-layer `--dsw-*` token
 * overrides applied as inline CSS variables over the base palette. The
 * colorScheme picks the base palette the skin builds on; tokens carry the
 * values for that scheme (the presenter switches `body[data-ds-dark-theme]`
 * from colorScheme, never from the id).
 */
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'

/** One selectable skin: theme definition plus row presentation data. */
export interface SkinCatalogEntry extends ThemeDefinition {
  /** Display name shown in the settings row. */
  name: string
  /** Preview swatch color for the row pill. */
  swatch: string
}

export const SKINS: readonly SkinCatalogEntry[] = Object.freeze([
  // ── midnight: 深蓝黑 + DeepSeek 蓝 ─────────────────────────────────────
  Object.freeze({
    id: 'midnight',
    name: '午夜',
    swatch: '#4D6BFE',
    colorScheme: 'dark',
    tokens: Object.freeze({
      '--dsw-alias-bg-base': '#0D1117',
      '--dsw-alias-bg-layer-1': '#161B22',
      '--dsw-alias-bg-layer-2': '#1C2128',
      '--dsw-alias-bg-overlay': '#21262D',
      '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.08)',
      '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.14)',
      '--dsw-alias-brand-primary': '#4D6BFE',
      '--dsw-alias-label-primary': '#E6EDF3',
      '--dsw-alias-label-secondary': '#8B949E',
      '--dsw-alias-state-error-primary': '#F85149',
      '--dsw-alias-state-success-primary': '#3FB950',
      '--dsw-alias-state-warn-primary': '#D29922',
      '--dsw-specific-sidebar-fill': '#11161D',
    }),
  }),

  // ── aurora: 紫罗兰夜色 + 品紫 accent ──────────────────────────────────
  Object.freeze({
    id: 'aurora',
    name: '极光',
    swatch: '#A78BFA',
    colorScheme: 'dark',
    tokens: Object.freeze({
      '--dsw-alias-bg-base': '#131120',
      '--dsw-alias-bg-layer-1': '#1B1830',
      '--dsw-alias-bg-layer-2': '#221E3A',
      '--dsw-alias-bg-overlay': '#2A2547',
      '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.08)',
      '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.14)',
      '--dsw-alias-brand-primary': '#A78BFA',
      '--dsw-alias-label-primary': '#EDEAF8',
      '--dsw-alias-label-secondary': '#A5A2BD',
      '--dsw-alias-state-error-primary': '#F87171',
      '--dsw-alias-state-success-primary': '#34D399',
      '--dsw-alias-state-warn-primary': '#FBBF24',
      '--dsw-specific-sidebar-fill': '#161329',
    }),
  }),

  // ── paper: 暖纸 + 墨绿 ────────────────────────────────────────────────
  Object.freeze({
    id: 'paper',
    name: '暖纸',
    swatch: '#3F6E5C',
    colorScheme: 'light',
    tokens: Object.freeze({
      '--dsw-alias-bg-base': '#F7F4EE',
      '--dsw-alias-bg-layer-1': '#FDFBF7',
      '--dsw-alias-bg-layer-2': '#F2EEE4',
      '--dsw-alias-bg-overlay': '#FFFFFF',
      '--dsw-alias-border-l1': 'rgba(60, 50, 30, 0.10)',
      '--dsw-alias-border-l2': 'rgba(60, 50, 30, 0.16)',
      '--dsw-alias-brand-primary': '#3F6E5C',
      '--dsw-alias-label-primary': '#2E2A22',
      '--dsw-alias-label-secondary': '#6E6656',
      '--dsw-alias-state-error-primary': '#C4473F',
      '--dsw-alias-state-success-primary': '#3E7C4F',
      '--dsw-alias-state-warn-primary': '#9A7B2F',
      '--dsw-specific-sidebar-fill': '#F1ECE1',
    }),
  }),
])

/** Registered skin ids, in registration order. */
export const SKIN_IDS: readonly string[] = Object.freeze(SKINS.map(skin => skin.id))

/** Is the id one of this pack's registered skins? */
export function isSkinId(id: string): boolean {
  return SKIN_IDS.includes(id)
}

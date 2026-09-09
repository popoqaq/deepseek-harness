/**
 * Skins row slot store: a mirror of the theme service snapshot. The plugin's
 * apply-world change listener is the only writer; the row component reads via
 * props.useStore. Mirrors the Appearance row store pattern.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Store state mirrored from the theme snapshot. */
export interface SkinsRowState {
  /** Active theme id (custom skin id or a built-in preference). */
  active: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type SkinsRowActions = {
  sync: (draft: SkinsRowState, active: string, revision: number) => void
}

/**
 * Declares the skins row state and write surface.
 * @returns the store handle.
 */
export function createSkinsRowStore(): EngineStoreHandle<SkinsRowState, SkinsRowActions> {
  return defineStore({
    init: (): SkinsRowState => ({ active: 'system', revision: -1 }),
    actions: {
      sync: (d, active: string, revision: number) => {
        if (revision <= d.revision) return
        d.active = active
        d.revision = revision
      },
    },
  })
}

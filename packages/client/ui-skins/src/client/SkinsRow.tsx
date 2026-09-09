/**
 * Skins row registered into General settings. Fixed skins are simple pills;
 * the custom skin expands into text mode and named wallpaper combinations.
 */
import { useState, type ChangeEvent } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings section's SlotMap merge ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  createWallpaperCombination, CUSTOM_ID, loadCustomFields, loadWallpaperCollection,
  type CustomFields, type WallpaperCollection, type WallpaperCombination,
} from './custom.ts'
import { SKINS } from './skins.ts'
import type { createSkinsRowStore } from './store.ts'
import css from './SkinsRow.module.css'

/** Injected business face. */
export interface SkinsRowInjected {
  /** Switch the active theme to a skin id and persist the pick. */
  setSkin: (id: string) => void
  /** Persist, re-register, and activate the custom wallpaper skin. */
  updateCustom: (fields: CustomFields) => void
  /** Persist the named wallpaper collection and repaint its active combination. */
  updateCustomWallpapers: (collection: WallpaperCollection) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SkinsRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSkinsRowStore>>
  & PropsLocale<'settings.skins'> & SkinsRowInjected

/** Longest edge a wallpaper is downscaled to before persisting. */
const WALLPAPER_MAX_EDGE = 1600

/** Fixed preview color for the wallpaper skin (there is no custom accent color). */
const CUSTOM_SWATCH = '#4D6BFE'

/** Read, resize, and JPEG-encode an uploaded image for localStorage. */
function processWallpaper(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('wallpaper file read failed'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('wallpaper image decode failed'))
      image.onload = () => {
        const scale = Math.min(1, WALLPAPER_MAX_EDGE / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (context === null) {
          reject(new Error('wallpaper canvas unavailable'))
          return
        }
        // JPEG has no alpha; use white behind transparent PNGs.
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
        context.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      image.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/** Render one of the two wallpaper controls inside the active combination. */
function WallpaperField({
  label,
  value,
  onFile,
  onClear,
  t,
}: {
  label: string
  value: string | null
  onFile: (event: ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
  t: SkinsRowComponentProps['t']
}) {
  return (
    <div className={css.wallpaperRow}>
      <span className={css.wallpaperLabel}>{label}</span>
      {value === null ? (
        <label className={css.uploadBtn}>
          {t('skins.upload')}
          <input type="file" accept="image/*" hidden onChange={onFile} />
        </label>
      ) : (
        <>
          <img className={css.thumb} src={value} alt="" />
          <button type="button" className={css.removeBtn} onClick={onClear}>
            {t('skins.remove')}
          </button>
        </>
      )}
    </div>
  )
}

/** Render the skins row. */
export function SkinsRow({
  t, setSkin, updateCustom, updateCustomWallpapers, useStore,
}: SkinsRowComponentProps) {
  const active = useStore(s => s.active)
  const [custom, setCustom] = useState<CustomFields>(() => loadCustomFields())
  const [wallpaperCollection, setWallpaperCollection] = useState<WallpaperCollection>(() => loadWallpaperCollection())
  const customActive = active === CUSTOM_ID
  const activeCombination = wallpaperCollection.combinations.find(
    combination => combination.id === wallpaperCollection.activeId,
  ) ?? wallpaperCollection.combinations[0]

  const patchCustom = (patch: Partial<CustomFields>): void => {
    const next = { ...custom, ...patch }
    setCustom(next)
    updateCustom(next)
  }

  const commitCollection = (next: WallpaperCollection): void => {
    setWallpaperCollection(next)
    updateCustomWallpapers(next)
  }

  const patchActiveCombination = (patch: Partial<WallpaperCombination>): void => {
    if (activeCombination === undefined) return
    commitCollection({
      ...wallpaperCollection,
      combinations: wallpaperCollection.combinations.map(combination => (
        combination.id === activeCombination.id ? { ...combination, ...patch } : combination
      )),
    })
  }

  const selectCombination = (id: string): void => {
    if (!wallpaperCollection.combinations.some(combination => combination.id === id)) return
    commitCollection({ ...wallpaperCollection, activeId: id })
  }

  const addCombination = (): void => {
    const combination = createWallpaperCombination(`${t('skins.newCombination')} ${wallpaperCollection.combinations.length + 1}`)
    commitCollection({
      activeId: combination.id,
      combinations: [...wallpaperCollection.combinations, combination],
    })
  }

  const deleteCombination = (): void => {
    if (activeCombination === undefined || wallpaperCollection.combinations.length <= 1) return
    const index = wallpaperCollection.combinations.findIndex(item => item.id === activeCombination.id)
    const combinations = wallpaperCollection.combinations.filter(item => item.id !== activeCombination.id)
    const nextActive = combinations[Math.min(Math.max(index, 0), combinations.length - 1)]
    if (nextActive === undefined) return
    commitCollection({ activeId: nextActive.id, combinations })
  }

  const setWallpaper = async (
    surface: 'sidebar' | 'main',
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-picking the same file
    if (file === undefined || activeCombination === undefined) return
    try {
      const dataUrl = await processWallpaper(file)
      patchActiveCombination({ [surface]: dataUrl })
    } catch (error) {
      console.error('[ui-skins] wallpaper failed:', error)
    }
  }

  const clearWallpaper = (surface: 'sidebar' | 'main'): void => {
    patchActiveCombination({ [surface]: null })
  }

  return (
    <div className={css.group}>
      <div className={css.title}>{t('skins.title')}</div>
      <div className={css.pillRow}>
        {SKINS.map(({ id, name, swatch }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.pill, active === id && css.selected)}
            aria-pressed={active === id}
            onClick={() => setSkin(id)}
          >
            <span className={css.swatch} style={{ background: swatch }} />
            {name}
          </button>
        ))}
        <button
          type="button"
          className={clsx(css.pill, customActive && css.selected)}
          aria-pressed={customActive}
          onClick={() => setSkin(CUSTOM_ID)}
        >
          <span className={css.swatch} style={{ background: CUSTOM_SWATCH }} />
          {t('skins.custom')}
        </button>
      </div>

      {customActive && activeCombination !== undefined && (
        <div className={css.editor}>
          <div className={css.fieldRow}>
            <span className={css.label}>{t('skins.combination')}</span>
            <select
              className={css.combinationSelect}
              value={activeCombination.id}
              onChange={event => selectCombination(event.target.value)}
            >
              {wallpaperCollection.combinations.map(combination => (
                <option key={combination.id} value={combination.id}>{combination.name}</option>
              ))}
            </select>
            <button type="button" className={css.smallBtn} onClick={addCombination}>
              {t('skins.addCombination')}
            </button>
            <button
              type="button"
              className={css.removeBtn}
              disabled={wallpaperCollection.combinations.length <= 1}
              onClick={deleteCombination}
            >
              {t('skins.deleteCombination')}
            </button>
          </div>
          <div className={css.fieldRow}>
            <label className={css.label} htmlFor="ui-skins-combination-name">{t('skins.combinationName')}</label>
            <input
              id="ui-skins-combination-name"
              className={css.nameInput}
              value={activeCombination.name}
              onChange={event => patchActiveCombination({ name: event.target.value })}
            />
          </div>
          <div className={css.fieldRow}>
            <span className={css.label}>{t('skins.scheme')}</span>
            <div className={css.segmented}>
              <button
                type="button"
                className={clsx(css.segBtn, custom.scheme === 'dark' && css.selected)}
                aria-pressed={custom.scheme === 'dark'}
                onClick={() => patchCustom({ scheme: 'dark' })}
              >
                {t('skins.dark')}
              </button>
              <button
                type="button"
                className={clsx(css.segBtn, custom.scheme === 'light' && css.selected)}
                aria-pressed={custom.scheme === 'light'}
                onClick={() => patchCustom({ scheme: 'light' })}
              >
                {t('skins.light')}
              </button>
            </div>
          </div>
          <WallpaperField
            label={t('skins.sidebarWallpaper')}
            value={activeCombination.sidebar}
            onFile={event => void setWallpaper('sidebar', event)}
            onClear={() => clearWallpaper('sidebar')}
            t={t}
          />
          <WallpaperField
            label={t('skins.mainWallpaper')}
            value={activeCombination.main}
            onFile={event => void setWallpaper('main', event)}
            onClear={() => clearWallpaper('main')}
            t={t}
          />
        </div>
      )}
    </div>
  )
}

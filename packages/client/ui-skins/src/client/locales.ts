/** `settings.skins` namespace dictionaries (the skins row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'skins.title': '我的皮肤',
  'skins.custom': '自定义壁纸',
  'skins.scheme': '文字模式',
  'skins.dark': '深色',
  'skins.light': '浅色',
  'skins.sidebarWallpaper': '侧边栏壁纸',
  'skins.mainWallpaper': '主内容壁纸',
  'skins.upload': '上传',
  'skins.remove': '移除',
  'skins.combination': '壁纸组合',
  'skins.combinationName': '组合名称',
  'skins.newCombination': '新组合',
  'skins.addCombination': '增加组合',
  'skins.deleteCombination': '删除组合',
} satisfies Record<string, string>

/** The settings.skins namespace key union. */
export type SkinsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'skins.title': 'My Skins',
  'skins.custom': 'Custom Wallpaper',
  'skins.scheme': 'Text mode',
  'skins.dark': 'Dark',
  'skins.light': 'Light',
  'skins.sidebarWallpaper': 'Sidebar wallpaper',
  'skins.mainWallpaper': 'Main content wallpaper',
  'skins.upload': 'Upload',
  'skins.remove': 'Remove',
  'skins.combination': 'Wallpaper combination',
  'skins.combinationName': 'Combination name',
  'skins.newCombination': 'New combination',
  'skins.addCombination': 'Add combination',
  'skins.deleteCombination': 'Delete combination',
} satisfies Record<SkinsKey, string>

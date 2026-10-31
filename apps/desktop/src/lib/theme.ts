export type ThemeKey = 'mist' | 'midnight' | 'sakura'

export type ThemePreferences = {
  theme: ThemeKey
  accent: string
  wallpaper: string
  wallpaperStrength: number
  wallpaperMotion: boolean
  blur: number
  glass: number
}

export const THEME_PRESETS: Array<{ key: ThemeKey; label: string; description: string }> = [
  { key: 'mist', label: '雾白', description: '清爽浅色，适合长时间管理图片' },
  { key: 'midnight', label: '深夜', description: '深色玻璃界面，适合夜间使用' },
  { key: 'sakura', label: '樱粉', description: '柔和粉色强调，不改变信息层级' },
]

export const WALLPAPER_PRESETS = [
  { value: 'preset:day', label: '晴空', image: '/art/sky-day.png' },
  { value: 'preset:sunset', label: '晚霞', image: '/art/sky-sunset.png' },
  { value: 'preset:night', label: '星夜', image: '/art/sky-night.png' },
]

const LOCAL_WALLPAPER_KEY = 'image-hosting-platform.wallpaper-v1'
const validLocalWallpaper = (value: string) => value.length <= 1_200_000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value)

export function storeLocalWallpaper(image: string) {
  if (!validLocalWallpaper(image)) throw new Error('壁纸图片无效，请重新导入。')
  window.localStorage.setItem(LOCAL_WALLPAPER_KEY, image)
}

export function clearLocalWallpaper() {
  window.localStorage.removeItem(LOCAL_WALLPAPER_KEY)
}

export function safeWallpaperUrl(value: string): string | null {
  const clean = value.trim()
  const preset = WALLPAPER_PRESETS.find((item) => item.value === clean)
  if (preset) return preset.image
  if (clean === 'local:wallpaper') {
    try {
      const image = window.localStorage.getItem(LOCAL_WALLPAPER_KEY)
      return image && validLocalWallpaper(image) ? image : null
    } catch { return null }
  }
  return /^https?:\/\//i.test(clean) ? clean : null
}

const STORAGE_KEY = 'image-hosting-platform.appearance-v1'

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  theme: 'sakura',
  accent: '#bd3c71',
  wallpaper: 'preset:day',
  wallpaperStrength: 100,
  wallpaperMotion: true,
  blur: 18,
  glass: 88,
}

export function withFrostedGlass(preferences: ThemePreferences): ThemePreferences {
  return { ...preferences, theme: 'midnight', glass: 18, blur: 10 }
}

const isThemeKey = (value: unknown): value is ThemeKey =>
  value === 'mist' || value === 'midnight' || value === 'sakura'

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const numberPreference = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback

function accentSoft(accent: string) {
  if (!isHexColor(accent)) return 'rgba(79, 70, 229, .12)'
  const hex = accent.slice(1)
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, .12)`
}

export function loadThemePreferences(): ThemePreferences {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === null) return { ...DEFAULT_THEME_PREFERENCES }
    const parsed = JSON.parse(saved) as Partial<ThemePreferences>
    return {
      theme: isThemeKey(parsed.theme) ? parsed.theme : DEFAULT_THEME_PREFERENCES.theme,
      accent: typeof parsed.accent === 'string' && isHexColor(parsed.accent) ? parsed.accent : DEFAULT_THEME_PREFERENCES.accent,
      wallpaper: typeof parsed.wallpaper === 'string' ? parsed.wallpaper : '',
      wallpaperStrength: numberPreference(parsed.wallpaperStrength, DEFAULT_THEME_PREFERENCES.wallpaperStrength, 0, 100),
      wallpaperMotion: typeof parsed.wallpaperMotion === 'boolean' ? parsed.wallpaperMotion : true,
      blur: numberPreference(parsed.blur, DEFAULT_THEME_PREFERENCES.blur, 0, 36),
      glass: numberPreference(parsed.glass, DEFAULT_THEME_PREFERENCES.glass, 10, 100),
    }
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES }
  }
}

export function applyThemePreferences(preferences: ThemePreferences) {
  const root = document.documentElement
  // The only place that writes these attributes, so the only place that can decide whether a
  // value is allowed to be written. loadThemePreferences rejecting a bad stored value protects one
  // caller; a settings panel, a migration or a test calling apply directly would still put
  // data-theme="banana" on the document - selecting no stylesheet rule at all, and nothing would
  // ever report it. Rejected values are a no-op, not a throw: a bad appearance setting must not
  // take the app down. Guarded per field, matching accent/blur/glass/wallpaper below, so one bad
  // key does not silently stop the others from applying.
  if (isThemeKey(preferences.theme)) {
    if (preferences.theme === 'mist') delete root.dataset.theme
    else root.dataset.theme = preferences.theme
  }

  const accent = isHexColor(preferences.accent) ? preferences.accent : DEFAULT_THEME_PREFERENCES.accent
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-soft', accentSoft(accent))
  root.style.setProperty('--backdrop-blur', `${numberPreference(preferences.blur, DEFAULT_THEME_PREFERENCES.blur, 0, 36)}px`)
  root.style.setProperty('--glass-strength', `${numberPreference(preferences.glass, DEFAULT_THEME_PREFERENCES.glass, 10, 100)}%`)
  root.style.setProperty('--wallpaper-strength', `${numberPreference(preferences.wallpaperStrength, DEFAULT_THEME_PREFERENCES.wallpaperStrength, 0, 100)}%`)

  // The local video is rendered as a blob-backed full-page layer; this image is its safe fallback.
  const wallpaper = preferences.wallpaper === 'local:video' ? '/art/sky-day.png' : safeWallpaperUrl(preferences.wallpaper)
  if (wallpaper) {
    root.style.setProperty('--wallpaper', `url(${JSON.stringify(wallpaper)})`)
    root.dataset.wallpaper = 'true'
  } else {
    root.style.setProperty('--wallpaper', 'none')
    delete root.dataset.wallpaper
  }
}

export function persistThemePreferences(preferences: ThemePreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  applyThemePreferences(preferences)
}

export function themeLabel(theme: ThemeKey) {
  return THEME_PRESETS.find((item) => item.key === theme)?.label || '雾白'
}

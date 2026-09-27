export type ThemeKey = 'mist' | 'midnight' | 'sakura'

export type ThemePreferences = {
  theme: ThemeKey
  accent: string
  wallpaper: string
  blur: number
  glass: number
}

export const THEME_PRESETS: Array<{ key: ThemeKey; label: string; description: string }> = [
  { key: 'mist', label: '雾白', description: '清爽浅色，适合长时间管理图片' },
  { key: 'midnight', label: '深夜', description: '深色玻璃界面，适合夜间使用' },
  { key: 'sakura', label: '樱粉', description: '柔和粉色强调，不改变信息层级' },
]

const STORAGE_KEY = 'image-hosting-platform.appearance-v1'

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  theme: 'mist',
  accent: '#4f46e5',
  wallpaper: '',
  blur: 18,
  glass: 88,
}

const isThemeKey = (value: unknown): value is ThemeKey =>
  value === 'mist' || value === 'midnight' || value === 'sakura'

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ThemePreferences>
    return {
      theme: isThemeKey(parsed.theme) ? parsed.theme : DEFAULT_THEME_PREFERENCES.theme,
      accent: typeof parsed.accent === 'string' && isHexColor(parsed.accent) ? parsed.accent : DEFAULT_THEME_PREFERENCES.accent,
      wallpaper: typeof parsed.wallpaper === 'string' ? parsed.wallpaper : '',
      blur: typeof parsed.blur === 'number' ? clamp(parsed.blur, 0, 36) : DEFAULT_THEME_PREFERENCES.blur,
      glass: typeof parsed.glass === 'number' ? clamp(parsed.glass, 45, 100) : DEFAULT_THEME_PREFERENCES.glass,
    }
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES }
  }
}

export function applyThemePreferences(preferences: ThemePreferences) {
  const root = document.documentElement
  if (preferences.theme === 'mist') delete root.dataset.theme
  else root.dataset.theme = preferences.theme

  const accent = isHexColor(preferences.accent) ? preferences.accent : DEFAULT_THEME_PREFERENCES.accent
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-soft', accentSoft(accent))
  root.style.setProperty('--backdrop-blur', `${clamp(preferences.blur, 0, 36)}px`)
  root.style.setProperty('--glass-strength', `${clamp(preferences.glass, 45, 100)}%`)

  const wallpaper = preferences.wallpaper.trim()
  if (/^https?:\/\//i.test(wallpaper)) {
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

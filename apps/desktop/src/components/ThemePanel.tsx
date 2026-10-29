import { Check, Image, Palette, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prepareWallpaper } from '../lib/wallpaperImport'
import {
  DEFAULT_THEME_PREFERENCES,
  THEME_PRESETS,
  WALLPAPER_PRESETS,
  safeWallpaperUrl,
  storeLocalWallpaper,
  clearLocalWallpaper,
  type ThemePreferences,
} from '../lib/theme'

const ACCENTS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#db5b8b', '#ea580c']

export function ThemePanel({
  value,
  onChange,
  onClose,
}: {
  value: ThemePreferences
  onChange: (next: ThemePreferences) => boolean
  onClose: () => void
}) {
  const [importing, setImporting] = useState(false)
  const [imageError, setImageError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function importImage(file: File) {
    setImporting(true)
    setImageError('')
    const previous = safeWallpaperUrl('local:wallpaper')
    try {
      const image = await prepareWallpaper(file)
      if (!alive.current) return
      storeLocalWallpaper(image)
      if (!onChange({ ...value, wallpaper: 'local:wallpaper' })) {
        if (previous) storeLocalWallpaper(previous)
        else clearLocalWallpaper()
      }
    } catch (error) {
      if (alive.current) setImageError(error instanceof Error ? error.message : '导入失败，原壁纸已保留。')
    } finally { if (alive.current) setImporting(false) }
  }
  function removeImage() {
    if (onChange({ ...value, wallpaper: value.wallpaper === 'local:wallpaper' ? '' : value.wallpaper })) {
      try { clearLocalWallpaper(); setImageError('') } catch { setImageError('本机图片未能清除，请稍后重试。') }
    }
  }
  const update = <K extends keyof ThemePreferences>(key: K, next: ThemePreferences[K]) =>
    onChange({ ...value, [key]: next })

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/20 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        onMouseDown={(event) => event.stopPropagation()}
        className="theme-surface flex h-full w-full max-w-[430px] flex-col border-l shadow-[-20px_0_70px_rgba(15,23,42,.16)]"
      >
        <header className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-5">
          <div className="grid size-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Palette size={18} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">界面皮肤</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">像手机壁纸一样换氛围，但不改变功能布局。设置会立即预览并自动保存。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--surface-soft)]" aria-label="关闭皮肤设置"><X size={17} /></button>
        </header>

        <fieldset disabled={importing} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5">
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles size={14} />预设主题</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {THEME_PRESETS.map((preset) => {
                const active = value.theme === preset.key
                return (
                  <button
                    key={preset.key}
                    onClick={() => update('theme', preset.key)}
                    className={`relative rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${active ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}
                    title={preset.description}
                  >
                    <div className={`mb-3 h-12 rounded-xl ${preset.key === 'mist' ? 'bg-gradient-to-br from-white to-slate-100' : preset.key === 'midnight' ? 'bg-gradient-to-br from-slate-800 to-slate-950' : 'bg-gradient-to-br from-white to-pink-100'}`} />
                    <div className="text-xs font-medium">{preset.label}</div>
                    {active && <Check size={12} className="absolute right-2 top-2 text-[var(--accent)]" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="mt-7">
            <div className="text-xs font-semibold">强调色</div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">用于选中状态、重点按钮和提示，不会把整个页面染成高饱和颜色。</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  onClick={() => update('accent', accent)}
                  className="grid size-9 place-items-center rounded-full border border-black/5 shadow-sm transition hover:scale-105"
                  style={{ background: accent }}
                  aria-label={`选择强调色 ${accent}`}
                >
                  {value.accent.toLowerCase() === accent && <Check size={15} className="text-white" />}
                </button>
              ))}
              <label className="grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-soft)]" title="自定义颜色">
                <input type="color" value={value.accent} onChange={(event) => update('accent', event.target.value)} className="h-14 w-14 cursor-pointer border-0 bg-transparent p-0" />
              </label>
            </div>
          </section>

          <section className="mt-7">
            <div className="flex items-center gap-2 text-xs font-semibold"><Image size={14} />壁纸</div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">选择天空插画，或导入自己的图片。导入图片只保存在本机，不会上传。</p>
            <div className="sky-presets mt-3">
              {WALLPAPER_PRESETS.map((preset) => <button key={preset.value} onClick={() => update('wallpaper', preset.value)} aria-pressed={value.wallpaper === preset.value} className="sky-preset" style={{ backgroundImage: `url(${preset.image})` }}><span>{preset.label}{value.wallpaper === preset.value ? ' ✓' : ''}</span></button>)}
            </div>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs focus-within:ring-2 focus-within:ring-[var(--accent)]">
              {importing ? '正在处理图片…' : value.wallpaper === 'local:wallpaper' ? '更换本机图片' : '导入本机图片'}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={importing} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importImage(file) }} />
            </label>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">PNG / JPG / WebP，最大 16 MB。自动缩小为壁纸副本，原图不变。</p>
            {imageError && <p role="alert" className="mt-2 text-xs text-red-600">{imageError}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <button className="text-xs text-[var(--text-secondary)] underline underline-offset-4" onClick={removeImage}>清除个人图片</button>
              <button className="text-xs text-[var(--text-secondary)] underline underline-offset-4" onClick={() => update('wallpaper', '')}>不使用壁纸</button>
            </div>
            <input
              value={value.wallpaper.startsWith('preset:') || value.wallpaper === 'local:wallpaper' ? '' : value.wallpaper}
              onChange={(event) => update('wallpaper', event.target.value)}
              aria-label="在线壁纸地址（可选）"
              placeholder="在线图片地址（可选）https://…"
              className="mt-3 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]"
            />
            {value.wallpaper && !safeWallpaperUrl(value.wallpaper) && (
              <div className="mt-2 text-[11px] text-amber-600">请选择预置天空或填写 http/https 图片地址。</div>
            )}
          </section>

          <section className="mt-7 space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
            <label className="block">
              <div className="flex items-center justify-between text-xs"><span className="font-medium">玻璃浓度</span><span className="text-[var(--text-muted)]">{value.glass}%</span></div>
              <input type="range" min="45" max="100" value={value.glass} onChange={(event) => update('glass', Number(event.target.value))} className="mt-3 w-full accent-[var(--accent)]" />
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">数值越低，壁纸透得越明显。</div>
            </label>
            <label className="block">
              <div className="flex items-center justify-between text-xs"><span className="font-medium">毛玻璃模糊</span><span className="text-[var(--text-muted)]">{value.blur}px</span></div>
              <input type="range" min="0" max="36" value={value.blur} onChange={(event) => update('blur', Number(event.target.value))} className="mt-3 w-full accent-[var(--accent)]" />
            </label>
          </section>
        </fieldset>

        <footer className="border-t border-[var(--border)] p-4">
          <div className="flex gap-2">
            <button disabled={importing} onClick={() => { if (onChange({ ...DEFAULT_THEME_PREFERENCES })) { try { clearLocalWallpaper(); setImageError('') } catch { setImageError('已恢复默认，个人图片清除失败，请重试。') } } }} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-medium"><RotateCcw size={13} />恢复默认</button>
            <button onClick={onClose} className="flex-1 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-medium text-white">完成</button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

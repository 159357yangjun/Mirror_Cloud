import { Check, Image, Palette, RotateCcw, Sparkles, X } from 'lucide-react'
import {
  DEFAULT_THEME_PREFERENCES,
  THEME_PRESETS,
  type ThemePreferences,
} from '../lib/theme'

const ACCENTS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#db5b8b', '#ea580c']

export function ThemePanel({
  value,
  onChange,
  onClose,
}: {
  value: ThemePreferences
  onChange: (next: ThemePreferences) => void
  onClose: () => void
}) {
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">先支持 http/https 图片地址，后续再加入本地图片选择与自动取色。</p>
            <input
              value={value.wallpaper}
              onChange={(event) => update('wallpaper', event.target.value)}
              placeholder="https://example.com/wallpaper.jpg"
              className="mt-3 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]"
            />
            {value.wallpaper && !/^https?:\/\//i.test(value.wallpaper.trim()) && (
              <div className="mt-2 text-[11px] text-amber-600">当前只接受 http/https 图片地址，不会把无效文本写进 CSS。</div>
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
        </div>

        <footer className="border-t border-[var(--border)] p-4">
          <div className="flex gap-2">
            <button onClick={() => onChange({ ...DEFAULT_THEME_PREFERENCES })} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-medium"><RotateCcw size={13} />恢复默认</button>
            <button onClick={onClose} className="flex-1 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-medium text-white">完成</button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

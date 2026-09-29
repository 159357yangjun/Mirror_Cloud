import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Boxes, Cloud, Images, ListTodo, Palette, Plug, Settings, Upload, Zap } from 'lucide-react'
import { getDocsBaseUrl, openExternalUrlOrReport } from '../lib/desktop'
import {
  applyThemePreferences,
  loadThemePreferences,
  persistThemePreferences,
  themeLabel,
  type ThemePreferences,
} from '../lib/theme'
import { useAppStore } from '../store/useAppStore'
import type { PageKey } from '../types'
import { HelpCenterDialog } from './HelpCenterDialog'
import { ThemePanel } from './ThemePanel'

const items: Array<{ key: PageKey; label: string; icon: typeof Boxes }> = [
  { key: 'publish', label: '发布', icon: Upload },
  { key: 'assets', label: '资源', icon: Boxes },
  { key: 'storages', label: '云端', icon: Cloud },
  { key: 'gallery', label: '图库', icon: Images },
  { key: 'plugins', label: '插件', icon: Plug },
  { key: 'tasks', label: '任务', icon: ListTodo },
  { key: 'settings', label: '设置', icon: Settings },
]

const FIRST_RUN_HELP_KEY = 'image-hosting-platform.help.seen-v1'

export function AppShell({ children }: { children: ReactNode }) {
  const { page, setPage, openUpload } = useAppStore()
  const docsUrl = getDocsBaseUrl()
  const [showHelp, setShowHelp] = useState(() => window.localStorage.getItem(FIRST_RUN_HELP_KEY) !== '1')
  const [showTheme, setShowTheme] = useState(false)
  const [appearance, setAppearance] = useState<ThemePreferences>(() => loadThemePreferences())

  useEffect(() => {
    applyThemePreferences(appearance)
  }, [appearance])

  function updateAppearance(next: ThemePreferences) {
    setAppearance(next)
    persistThemePreferences(next)
  }

  function closeHelp() {
    window.localStorage.setItem(FIRST_RUN_HELP_KEY, '1')
    setShowHelp(false)
  }

  return (
    <div className="app-shell-root min-h-screen text-[var(--text-primary)]">
      <aside className="app-sidebar theme-glass fixed inset-y-0 left-0 z-30 w-[220px] border-r">
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="grid size-9 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm"><Zap size={17} /></div>
            <div className="app-brand-copy">
              <div className="text-[15px] font-semibold tracking-[-0.02em]">图床</div>
              <div className="text-[11px] text-[var(--text-muted)]">Image Hosting Platform</div>
            </div>
          </div>

          <button
            className="app-upload-button mt-5 flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_30px_rgba(15,23,42,.16)] transition hover:-translate-y-0.5"
            onClick={() => openUpload('files')}
          >
            <Upload size={16} /> <span className="app-upload-label">快速发布</span>
          </button>

          <nav className="mt-6 space-y-1">
            {items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  page === key
                    ? 'bg-[var(--surface-soft)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span className="app-nav-label">{label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-2">
            <button
              onClick={() => setShowTheme(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              title="打开皮肤面板：主题、强调色、壁纸、玻璃透明度与模糊"
            >
              <Palette size={14} /> <span className="app-docs-label">皮肤 · {themeLabel(appearance.theme)}</span>
            </button>
            <button
              onClick={() => setShowHelp(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              title="打开应用内新手教程"
            >
              <BookOpen size={14} /> <span className="app-docs-label">教程与帮助</span>
            </button>
            <div className="app-sidebar-footer theme-surface rounded-2xl border p-3">
              <div className="text-xs font-medium text-[var(--text-secondary)]">v1.4 Preview · Image Hosting Platform</div>
              <div className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">托管 · 管理 · 发布 · 多云可靠性</div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-600"><span className="size-1.5 rounded-full bg-emerald-500" /> UX / Sync / Theme 开发中</div>
            </div>
          </div>
        </div>
      </aside>
      <main className="app-main ml-[220px] min-h-screen">{children}</main>
      {showHelp && (
        <HelpCenterDialog
          onClose={closeHelp}
          onNavigate={setPage}
          onlineDocsUrl={docsUrl}
          openExternalUrl={openExternalUrlOrReport}
        />
      )}
      {showTheme && (
        <ThemePanel
          value={appearance}
          onChange={updateAppearance}
          onClose={() => setShowTheme(false)}
        />
      )}
    </div>
  )
}

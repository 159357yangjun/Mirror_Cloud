import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Boxes, Cloud, Images, ListTodo, Palette, Plug, Settings, Upload } from 'lucide-react'
import { checkForUpdates, getDocsBaseUrl, getUpdateStatus, openExternalUrlOrReport } from '../lib/desktop'
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
import { VideoWallpaper } from './VideoWallpaper'
import { notifyError } from '../store/useToastStore'

const items: Array<{ key: PageKey; label: string; icon: typeof Boxes }> = [
  { key: 'publish', label: '上传', icon: Upload },
  { key: 'assets', label: '上传记录', icon: Boxes },
  { key: 'storages', label: '云端配置', icon: Cloud },
  { key: 'gallery', label: '云端文件', icon: Images },
  { key: 'plugins', label: '插件', icon: Plug },
  { key: 'tasks', label: '任务', icon: ListTodo },
  { key: 'settings', label: '设置', icon: Settings },
]

const FIRST_RUN_HELP_KEY = 'image-hosting-platform.help.seen-v1'

export function AppShell({ children }: { children: ReactNode }) {
  const { page, setPage, openUpload, updateAvailableVersion } = useAppStore()
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    // A new page starts at its heading; never carry a long settings-page offset into it.
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [page])
  const docsUrl = getDocsBaseUrl()
  const [showHelp, setShowHelp] = useState(() => window.localStorage.getItem(FIRST_RUN_HELP_KEY) !== '1')
  const [showTheme, setShowTheme] = useState(false)
  const [appearance, setAppearance] = useState<ThemePreferences>(() => loadThemePreferences())

  useEffect(() => {
    applyThemePreferences(appearance)
  }, [appearance])

  // Startup update awareness, cache-first: a fresh stored answer costs zero requests, and only an
  // expired one triggers a background check. Every failure path here is silent on purpose - this is
  // the launch sequence, and a network wobble while looking for a newer version must not surface as
  // an error the user did not ask about. Manual checks (Settings page) keep their visible errors.
  const setUpdateAvailableVersion = useAppStore((state) => state.setUpdateAvailableVersion)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cached = await getUpdateStatus()
        if (cancelled) return
        if (cached.fresh) {
          if (cached.result?.updateAvailable) setUpdateAvailableVersion(cached.result.latestVersion)
          return
        }
        const checked = await checkForUpdates()
        if (!cancelled && checked.updateAvailable) setUpdateAvailableVersion(checked.latestVersion)
      } catch {
        // Silent: see the comment above.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setUpdateAvailableVersion])

  function updateAppearance(next: ThemePreferences) {
    try {
      persistThemePreferences(next)
      setAppearance(next)
      return true
    } catch {
      notifyError('外观设置未保存，本机存储空间可能不足。原设置已保留。')
      return false
    }
  }

  function closeHelp() {
    window.localStorage.setItem(FIRST_RUN_HELP_KEY, '1')
    setShowHelp(false)
  }

  return (
    <div className="app-shell-root min-h-screen text-[var(--text-primary)]" data-page={page}>
      <header className="app-mobile-navigation theme-glass" aria-label="窄窗口导航">
        <label>镜云<select aria-label="主要页面" value={page} onChange={(event) => setPage(event.target.value as PageKey)}>{items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <div className="app-mobile-actions">
          <button onClick={() => openUpload('files')} aria-label="快速发布图片" title="快速上传"><Upload size={18} /></button>
          <button onClick={() => setShowTheme(true)} aria-label="打开壁纸与外观" title="壁纸与外观"><Palette size={18} /></button>
          <button onClick={() => setShowHelp(true)} aria-label="打开教程与帮助" title="教程与帮助"><BookOpen size={18} /></button>
        </div>
      </header>
      {appearance.wallpaper === 'local:video' && <VideoWallpaper motion={appearance.wallpaperMotion && appearance.wallpaperStrength > 0} />}
      <a href="#mirror-main" className="sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:not-sr-only focus:rounded-lg focus:bg-[var(--surface)] focus:px-3 focus:py-2 text-sm focus:font-semibold focus:text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent)]">跳到主工作区</a>
      <aside aria-label="应用导航" className="app-sidebar theme-glass fixed inset-y-0 left-0 z-30 border-r">
        <div className="flex min-h-full flex-col p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="app-brand-mark grid size-9 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm"><Cloud size={20} /></div>
            <div className="app-brand-copy">
              <div className="text-[15px] font-semibold tracking-[-0.02em]">镜云</div>
              <div className="text-xs text-[var(--text-muted)]">Mirror Cloud</div>
            </div>
          </div>

          <button
            className="app-upload-button mt-5 flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_30px_rgba(15,23,42,.16)] transition hover:-translate-y-0.5"
            onClick={() => openUpload('files')}
            aria-label="快速发布图片"
            title="快速发布图片"
          >
            <Upload size={16} /> <span className="app-upload-label">快速上传</span>
          </button>

          <nav aria-label="主要页面" className="mt-6 space-y-1">
            {items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                aria-label={`切换到${label}页面`}
                aria-current={page === key ? 'page' : undefined}
                title={label}
                className={`app-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  page === key
                    ? 'bg-[var(--surface-soft)] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border)]'
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
              aria-label={`打开皮肤设置，当前主题${themeLabel(appearance.theme)}`}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              title="打开皮肤面板：主题、强调色、壁纸、玻璃透明度与模糊"
            >
              <Palette size={14} /> <span className="app-docs-label">皮肤 · {themeLabel(appearance.theme)}</span>
            </button>
            <button
              onClick={() => setShowHelp(true)}
              aria-label="打开教程与帮助"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              title="打开应用内新手教程"
            >
              <BookOpen size={14} /> <span className="app-docs-label">教程与帮助</span>
            </button>
            <div className="app-sidebar-footer theme-surface rounded-2xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs font-medium text-[var(--text-secondary)]">
                  v{__APP_VERSION__} · Mirror Cloud
                  {__APP_CANDIDATE_LABEL__ && <div className="mt-1 break-all font-mono text-xs text-amber-700">{__APP_CANDIDATE_LABEL__}</div>}
                </div>
                {updateAvailableVersion && (
                  <button
                    onClick={() => { useAppStore.getState().setSettingsSection('about'); setPage('settings') }}
                    title={`发现新版本 v${updateAvailableVersion}，点击去设置`}
                    aria-label={`发现新版本 v${updateAvailableVersion}`}
                    className="size-2.5 shrink-0 rounded-full bg-amber-500"
                  />
                )}
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">图片上传 · 云端管理 · 任务追踪</div>
              <div className="mt-3 text-xs leading-5 text-[var(--text-muted)]">检查更新仅提示；下载和安装需手动确认</div>
            </div>
          </div>
        </div>
      </aside>
      <main ref={mainRef} id="mirror-main" tabIndex={-1} className="app-main min-h-screen">
        <div className="app-page-surface">{children}</div>
      </main>
      {showHelp && (
        <HelpCenterDialog
          onClose={closeHelp}
          onNavigate={(page, settingsSection) => {
            if (page === 'settings') useAppStore.getState().setSettingsSection(settingsSection ?? 'output')
            setPage(page)
            if (mainRef.current) mainRef.current.scrollTop = 0
          }}
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

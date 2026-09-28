import { useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { UploadDialog } from './components/UploadDialog'
import { copyText, getOutputPreferences, isTauriRuntime } from './lib/desktop'
import { formatPublishedAsset } from './lib/output'
import { AssetsPage } from './pages/AssetsPage'
import { PublishPage } from './pages/PublishPage'
import { SettingsPage } from './pages/SettingsPage'
import { GalleryPage } from './pages/GalleryPage'
import { StoragesPage } from './pages/StoragesPage'
import { TasksPage } from './pages/TasksPage'
import { PluginsPage } from './pages/PluginsPage'
import { ToastViewport } from './components/ToastViewport'
import { useAppStore } from './store/useAppStore'
import { notifyError } from './store/useToastStore'

type PublishedEvent = { name: string; publicUrl: string; pluginOutputs?: Array<{ pluginId: string; pluginName: string; pluginKind: string; text: string; data: unknown }> }

export default function App() {
  const page = useAppStore((s) => s.page)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<PublishedEvent>('asset://published', async (event) => {
        const { name, publicUrl } = event.payload
        if (!publicUrl) return
        const preferences = await getOutputPreferences()
        if (!preferences.autoCopyAfterPublish) return
        try {
          await copyText(formatPublishedAsset(name, publicUrl, preferences))
        } catch {
          notifyError('发布成功，但自动复制失败，请到资源页手动复制')
        }
      }).then((cleanup) => { unlisten = cleanup }),
    )
    return () => unlisten?.()
  }, [])

  return (
    <AppShell>
      {page === 'publish' && <PublishPage />}
      {page === 'assets' && <AssetsPage />}
      {page === 'storages' && <StoragesPage />}
      {page === 'gallery' && <GalleryPage />}
      {page === 'plugins' && <PluginsPage />}
      {page === 'tasks' && <TasksPage />}
      {page === 'settings' && <SettingsPage />}
      <UploadDialog />
      <ToastViewport />
    </AppShell>
  )
}

import { useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { UploadDialog } from './components/UploadDialog'
import { copyText, getOutputPreferences, isTauriRuntime } from './lib/desktop'
import { formatPublishedAsset } from './lib/output'
import { PageHost } from './plugin-ui/PageHost'
import { ToastViewport } from './components/ToastViewport'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useAppStore } from './store/useAppStore'
import { notifyError } from './store/useToastStore'
import { manageDesktopSubscription } from './platform/desktop/subscription'

type PublishedEvent = { name: string; publicUrl: string; pluginOutputs?: Array<{ pluginId: string; pluginName: string; pluginKind: string; text: string; data: unknown }> }

export default function App() {
  const page = useAppStore((s) => s.page)

  useEffect(() => {
    if (!isTauriRuntime()) return
    return manageDesktopSubscription(() => import('@tauri-apps/api/event').then(({ listen }) =>
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
      }),
    ), () => notifyError('发布结果通知暂不可用，请到资源页检查结果并复制链接'))
  }, [])

  return (
    <AppShell>
      <PageHost page={page} />
      <UploadDialog />
      <ToastViewport />
      <ConfirmDialog />
    </AppShell>
  )
}

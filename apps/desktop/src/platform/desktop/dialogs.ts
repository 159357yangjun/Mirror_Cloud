import { isTauriRuntime } from './runtime'

export async function chooseImageFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return []
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  })
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

export async function chooseDownloadPath(suggestedName: string): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggestedName })
}

export async function choosePluginManifestFile(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'Plugin Manifest', extensions: ['json'] }] })
  return typeof path === 'string' ? path : null
}

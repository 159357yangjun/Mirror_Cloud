import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { PluginImportPreview, PluginView } from '../../types'

export async function previewLocalPlugin(path: string): Promise<PluginImportPreview> {
  if (!isTauriRuntime()) throw new Error('请在桌面应用中导入插件')
  return invoke('preview_local_plugin', { path })
}

export async function installLocalPlugin(importId: string): Promise<PluginView> {
  if (!isTauriRuntime()) throw new Error('请在桌面应用中安装插件')
  return invoke('install_local_plugin', { importId })
}

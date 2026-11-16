import { AssetsPage } from '../pages/AssetsPage'
import { GalleryPage } from '../pages/GalleryPage'
import { PluginsPage } from '../pages/PluginsPage'
import { PublishPage } from '../pages/PublishPage'
import { SettingsPage } from '../pages/SettingsPage'
import { StoragesPage } from '../pages/StoragesPage'
import { TasksPage } from '../pages/TasksPage'
import type { PageEntry, PluginUiModule } from './types'

/** 内核基础页：存活不依赖任何插件，禁用插件不影响它们。 */
const kernelPages: PageEntry[] = [
  { id: 'assets', pluginId: 'kernel', title: '上传记录', component: AssetsPage, builtin: true },
  { id: 'storages', pluginId: 'kernel', title: '云端配置', component: StoragesPage, builtin: true },
  { id: 'plugins', pluginId: 'kernel', title: '插件', component: PluginsPage, builtin: true },
  { id: 'settings', pluginId: 'kernel', title: '设置', component: SettingsPage, builtin: true },
]

/** 内置插件承载的页面：禁用对应插件后由 PageHost 返回空，导航也随贡献点消失。 */
const pluginPages: PageEntry[] = [
  { id: 'publish', pluginId: 'publish-strategy', title: '发布', component: PublishPage, builtin: false },
  { id: 'gallery', pluginId: 'cloud-browser', title: '云端文件', component: GalleryPage, builtin: false },
  { id: 'tasks', pluginId: 'task-console', title: '任务', component: TasksPage, builtin: false },
]

// 构建期静态收集（ADR 0004）：v1 只从内置插件目录取 UI 模块，不做运行时下载。
// 该 glob 在没有任何插件 UI 时返回空对象，Vite 不报错。
const pluginUiModules = import.meta.glob('../plugins/*/ui.ts', {
  eager: true,
}) as Record<string, PluginUiModule>

function collectPluginUiPages(): PageEntry[] {
  const pages: PageEntry[] = []
  for (const module of Object.values(pluginUiModules)) {
    if (Array.isArray(module.pages)) pages.push(...module.pages)
  }
  return pages
}

const registry = new Map<string, PageEntry>()
for (const entry of [...kernelPages, ...pluginPages, ...collectPluginUiPages()]) {
  const existing = registry.get(entry.id)
  // 内核页优先：插件不得覆盖基础页；重复 id 只保留先注册者。
  if (existing?.builtin) continue
  registry.set(entry.id, entry)
}

/** 按稳定 id 解析页面；未知或已注销返回 undefined（调用方渲染空）。 */
export function resolvePage(id: string): PageEntry | undefined {
  return registry.get(id)
}

/** 当前可见页面列表（内核页 + 启用插件页，P1 均为构建期内置）。 */
export function allPages(): PageEntry[] {
  return [...registry.values()]
}

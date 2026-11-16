import type { ComponentType } from 'react'

/** 贡献点白名单，与 `crates/kernel-api` 的 `ContributionPoint` 同值。 */
export const CONTRIBUTION_POINTS = [
  'provider',
  'image_op',
  'workflow_step',
  'hook',
  'settings',
  'page',
  'command',
  'publish_strategy',
  'tray_item',
] as const

export type ContributionPoint = (typeof CONTRIBUTION_POINTS)[number]

/** 页面贡献：v1 由构建期 registry 收集，禁用插件即注销，不做运行时远程加载。 */
export interface PageEntry {
  /** 稳定贡献 id，例如 `page.publish`。 */
  id: string
  /** 归属插件 id；内核提供的基础页用 `kernel`。 */
  pluginId: string
  title: string
  component: ComponentType
  /** true = 内核提供，插件不能覆盖。 */
  builtin: boolean
}

/** 插件 UI 模块约定：默认导出 `pages` 数组（构建期静态收集）。 */
export interface PluginUiModule {
  pages?: PageEntry[]
}

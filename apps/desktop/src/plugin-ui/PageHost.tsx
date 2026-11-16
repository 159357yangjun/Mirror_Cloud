import { resolvePage } from './registry'

/**
 * 页面宿主：唯一的路由出口。
 *
 * 调用方只传稳定页面 id；解析失败（插件禁用/页面未注册）时渲染空内容而不是崩溃，
 * 深链回落由导航层在解析失败时跳到 `publish`（P2 接入）。
 */
export function PageHost({ page }: { page: string }) {
  const entry = resolvePage(page)
  if (!entry) return null
  const Component = entry.component
  return <Component />
}

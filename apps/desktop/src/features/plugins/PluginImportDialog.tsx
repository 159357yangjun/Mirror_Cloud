import type { PluginImportPreview } from '../../types'
import { useEffect, useRef } from 'react'

const labels: Record<string, string> = { read_asset: '读取资源', network: '访问网络', secret: '读取密钥', external_write: '向外部服务写入' }

export function PluginImportDialog({ preview, busy, onCancel, onInstall }: {
  preview: PluginImportPreview
  busy: boolean
  onCancel: () => void
  onInstall: () => void
}) {
  const p = preview.plugin
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (first) first.focus()
    else panel.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel() }
      if (event.key === 'Tab') {
        const controls = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!controls.length) { event.preventDefault(); return }
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [busy, onCancel])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="plugin-import-title" className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 text-slate-900">
      <h2 id="plugin-import-title" className="text-lg font-semibold">确认安装本地插件</h2>
      <p className="mt-3 font-medium">{p.name} · {p.version}</p>
      <p className="break-all text-xs text-slate-500">{p.id} · {p.kind} · API {p.apiVersion} / Schema {p.schemaVersion}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.description}</p>
      <p className="mt-4 text-sm">声明权限：{p.permissions.map((item) => labels[item] || item).join('、')}</p>
      <p className="mt-2 break-words text-xs">支持触发器：{p.supportedHooks.join('、')}</p>
      <p className="mt-3 text-sm text-amber-800">安装后默认关闭。安装不会执行插件或授予网络、密钥、外部写入权限；开启时会单独请求授权。</p>
      <div className="mt-5 flex justify-end gap-3">
        <button autoFocus disabled={busy} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">取消</button>
        <button disabled={busy} onClick={onInstall} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">{busy ? '安装中…' : '安装并保持关闭'}</button>
      </div>
    </section>
  </div>
}

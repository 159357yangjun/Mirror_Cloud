import { LoaderCircle, RefreshCw, Shield } from 'lucide-react'
import type { SystemDiagnosticsView } from '../../types'

interface SystemDiagnosticsPanelProps {
  diagnostics: SystemDiagnosticsView | undefined
  diagnosticsError: unknown
  diagnosticsChecking: boolean
  refreshDiagnostics: () => unknown
}

export function SystemDiagnosticsPanel({ diagnostics, diagnosticsError, diagnosticsChecking, refreshDiagnostics }: SystemDiagnosticsPanelProps) {
  return (
    <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-sm font-semibold"><Shield size={16} /> 系统诊断</div><div className="mt-1 text-xs leading-5 text-slate-400">集中检查本地数据库、默认上传链、Local API、Storage、插件和任务状态。</div></div>
        <button onClick={() => void refreshDiagnostics()} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">{diagnosticsChecking ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新检查</button>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {[
          ['Storage', diagnostics ? `${diagnostics.enabledStorageCount}/${diagnostics.storageCount} 启用` : '—'],
          ['插件', diagnostics ? `${diagnostics.enabledPluginCount}/${diagnostics.pluginCount} 启用` : '—'],
          ['任务', diagnostics ? `${diagnostics.activeTaskCount} 运行 · ${diagnostics.failedTaskCount} 失败` : '—'],
          ['Local API', diagnostics ? (diagnostics.localApiRunning ? '运行中' : '未运行') : '—'],
        ].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold text-slate-700">{value}</div></div>)}
      </div>
      {diagnosticsError ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3">
          <div className="text-xs font-medium text-red-700">系统诊断读取失败</div>
          <div className="mt-1 text-[11px] leading-5 text-red-600">{String(diagnosticsError).replace(/^Error:\s*/i, '')}</div>
        </div>
      ) : (
      <div className={`mt-4 rounded-2xl border px-4 py-3 ${diagnostics?.status === 'healthy' ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
        <div className="text-xs font-medium text-slate-700">{!diagnostics ? '正在检查核心状态…' : diagnostics.status === 'healthy' ? '核心状态正常' : '有项目需要处理'}</div>
        <div className="mt-1 text-[11px] text-slate-500">版本 {diagnostics?.appVersion || '—'} · 默认上传链：{diagnostics ? diagnostics.defaultWorkflow || '未配置' : '—'}</div>
        {!!diagnostics?.warnings.length && <div className="mt-2 space-y-1">{diagnostics.warnings.map((warning) => <div key={warning} className="text-[11px] text-amber-700">• {warning}</div>)}</div>}
      </div>
      )}
    </section>
  )
}

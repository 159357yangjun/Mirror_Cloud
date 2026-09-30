import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, Bot, CheckCircle2, ChevronDown, ChevronUp, Download, LoaderCircle, Plug, Power, Search, Send, Sparkles, Store, Trash2, Zap } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiPlanWorkflow, deletePlugin, getAiSettings, installMarketplacePlugin, listMarketplacePlugins, listPluginExecutionLogs, listPlugins, saveAiSettings, savePluginConfig, setPluginEnabled, setPluginHooks, setPluginPermissions } from '../lib/desktop'
import { PageHeader } from '../components/PageHeader'
import type { AiSettings, PluginView } from '../types'
import { notifyError } from '../store/useToastStore'
import { confirmAction } from '../store/useConfirmStore'

// The global MutationCache already turns a failed plugin mutation into a toast, so these catch
// handlers exist only to stop an unhandled rejection — a second dialog would report it twice.
const ignoreReportedFailure = () => undefined

export function PluginsPage() {
  const qc = useQueryClient()
  const { data: market = [] } = useQuery({ queryKey: ['plugin-market'], queryFn: listMarketplacePlugins })
  const { data: installed = [], error: pluginsError, isLoading: pluginsLoading } = useQuery({ queryKey: ['plugins'], queryFn: listPlugins })
  const { data: executionLogs = [] } = useQuery({ queryKey: ['plugin-execution-logs'], queryFn: () => listPluginExecutionLogs(40), refetchInterval: 2500 })
  const { data: ai } = useQuery({ queryKey: ['ai-settings'], queryFn: getAiSettings })
  const [settings, setSettings] = useState<AiSettings>({ baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' })
  const [request, setRequest] = useState('')
  const [plan, setPlan] = useState('')
  const [query, setQuery] = useState('')
  const [showMarket, setShowMarket] = useState(false)
  const [showAi, setShowAi] = useState(false)

  useEffect(() => { if (ai) setSettings(ai) }, [ai])

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['plugins'] })
    await qc.invalidateQueries({ queryKey: ['plugin-market'] })
    await qc.invalidateQueries({ queryKey: ['plugin-execution-logs'] })
  }
  const install = useMutation({ mutationFn: installMarketplacePlugin, onSuccess: refresh })
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setPluginEnabled(id, enabled), onSuccess: refresh })
  const authorize = useMutation({ mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) => setPluginPermissions(id, permissions), onSuccess: refresh })
  const hooks = useMutation({ mutationFn: ({ id, values }: { id: string; values: string[] }) => setPluginHooks(id, values), onSuccess: refresh })
  const remove = useMutation({ mutationFn: deletePlugin, onSuccess: refresh })
  const saveAi = useMutation({ mutationFn: saveAiSettings, onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings'] }) })
  const planMut = useMutation({ mutationFn: aiPlanWorkflow, onSuccess: (v) => setPlan(JSON.stringify(v, null, 2)) })

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return installed
    return installed.filter((plugin) => `${plugin.name} ${plugin.description} ${plugin.kind}`.toLowerCase().includes(term))
  }, [installed, query])
  const enabledCount = installed.filter((plugin) => plugin.enabled).length

  const permissionLabel = (permission: string) => ({ read_asset: '读取资源', network: '访问网络', secret: '读取密钥', external_write: '向外部服务写入' }[permission] ?? permission)
  const hookLabel = (hook: string) => ({ before_process: '处理前', after_process: '处理后', after_upload: '上传后', on_publish_failure: '发布失败', on_gallery_delete: '云端删除后', manual_trigger: '手动执行' }[hook] ?? hook)

  async function setPluginState(plugin: PluginView, enabled: boolean) {
    if (enabled) {
      const missing = plugin.permissions.filter((permission) => !plugin.grantedPermissions.includes(permission))
      if (missing.length) {
        const accepted = await confirmAction({ title: '插件权限请求', detail: `“${plugin.name}”请求以下权限：\n\n${missing.map((permission) => `• ${permissionLabel(permission)}`).join('\n')}\n\n允许后该插件在开启期间可使用这些能力。是否始终允许？`, confirmLabel: '始终允许', cancelLabel: '不开启', danger: false })
        if (!accepted) return
        await authorize.mutateAsync({ id: plugin.id, permissions: plugin.permissions })
      }
    }
    await toggle.mutateAsync({ id: plugin.id, enabled })
  }

  async function revokeSensitivePermissions(plugin: PluginView) {
    await toggle.mutateAsync({ id: plugin.id, enabled: false })
    await authorize.mutateAsync({ id: plugin.id, permissions: plugin.permissions.filter((permission) => permission === 'read_asset') })
    await refresh()
  }

  async function setAll(enabled: boolean) {
    try {
      for (const plugin of installed) await setPluginState(plugin, enabled)
      await refresh()
    } catch {
      notifyError('批量操作已中断，未处理的插件保持原状态')
      await refresh()
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-10 py-9">
      <PageHeader title="插件" description="这里就是上传行为开关。开启的插件会在图片真正上传成功后自动执行；关闭后立即停止参与后续上传。" />

      <section className="mt-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_40px_rgba(15,23,42,.04)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold"><Zap size={18} />上传插件</div>
            <p className="mt-1 text-xs leading-5 text-slate-400">本地上传、Typora 和内部处理链共享这一组开关。插件失败只记录提示，不会把已经上传成功的图片判为失败。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">已开启 {enabledCount}/{installed.length}</span>
            <button disabled={!installed.length} onClick={() => void setAll(true)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-30">全部开启</button>
            <button disabled={!installed.length} onClick={() => void setAll(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-30">全部关闭</button>
          </div>
        </div>

        <div className="relative mt-5 max-w-md">
          <Search size={14} className="absolute left-3 top-3 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索已安装插件" className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-slate-400" />
        </div>

        <div className="mt-5 space-y-3">
          {filtered.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              plugin={plugin}
              busy={toggle.isPending || authorize.isPending || hooks.isPending || remove.isPending}
              onToggle={(enabled) => { void setPluginState(plugin, enabled).then(refresh).catch(ignoreReportedFailure) }}
              onRevokePermissions={() => { void revokeSensitivePermissions(plugin).catch(ignoreReportedFailure) }}
              onToggleHook={(hook) => { const values = plugin.enabledHooks.includes(hook) ? plugin.enabledHooks.filter((item) => item !== hook) : [...plugin.enabledHooks, hook]; void hooks.mutateAsync({ id: plugin.id, values }).catch(ignoreReportedFailure) }}
              hookLabel={hookLabel}
              onRemove={() => { void confirmAction({ title: '卸载插件', detail: `卸载插件“${plugin.name}”吗？`, confirmLabel: '卸载' }).then((accepted) => accepted && remove.mutate(plugin.id)) }}
              onSaved={refresh}
            />
          ))}
          {pluginsError && !installed.length && (
            <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 px-5 py-10 text-center text-sm text-red-600">插件列表读取失败：{String(pluginsError)}</div>
          )}
          {pluginsLoading && <div className="grid min-h-[160px] place-items-center rounded-2xl bg-slate-50/60 text-slate-300"><LoaderCircle size={20} className="animate-spin" /></div>}
          {!pluginsError && !pluginsLoading && !filtered.length && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center">
              <Plug size={22} className="mx-auto text-slate-300" />
              <div className="mt-3 text-sm font-medium">还没有可切换的插件</div>
              <div className="mt-1 text-xs text-slate-400">从下方插件市场安装一个。新插件默认关闭，配置完成后再手动开启。</div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-[26px] border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-5">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><Activity size={16} /></div><div><div className="text-sm font-semibold">插件执行记录</div><div className="mt-0.5 text-xs text-slate-400">记录最近 Hook 的成功、失败与耗时，方便定位 Webhook / AI 插件问题。</div></div></div>
          <div className="text-[10px] text-slate-400">最近 {executionLogs.length} 条</div>
        </div>
        <div className="max-h-72 overflow-auto">
          {!executionLogs.length && <div className="p-8 text-center text-xs text-slate-400">暂无插件执行记录</div>}
          {executionLogs.map((log, index) => (
            <div key={log.id} className={`flex items-start gap-3 px-5 py-3 ${index ? 'border-t border-slate-100' : ''}`}>
              <div className={`mt-1 size-2 rounded-full ${log.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium text-slate-700">{log.pluginName}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{hookLabel(log.hook)}</span><span className={log.status === 'success' ? 'text-emerald-600' : 'text-red-600'}>{log.status === 'success' ? '成功' : '失败'}</span></div>{log.message && <div className="mt-1 break-all text-[10px] leading-5 text-red-500">{log.message}</div>}<div className="mt-1 text-[10px] text-slate-400">{log.durationMs} ms · {new Date(log.createdAt).toLocaleString()}</div></div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-[26px] border border-slate-200 bg-white">
        <button onClick={() => setShowMarket((v) => !v)} className="flex w-full items-center justify-between gap-4 p-5 text-left">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100"><Store size={16} /></div><div><div className="text-sm font-semibold">插件市场</div><div className="mt-0.5 text-xs text-slate-400">安装新的处理、通知和 AI 能力；安装后默认关闭，避免未配置就参与上传。</div></div></div>
          {showMarket ? <ChevronUp size={17} className="text-slate-400" /> : <ChevronDown size={17} className="text-slate-400" />}
        </button>
        {showMarket && <div className="border-t border-slate-100 p-5"><div className="grid grid-cols-2 gap-3">{market.map((plugin) => <PluginCard key={plugin.id} p={plugin} action={plugin.installed ? <span className="text-xs text-emerald-600">已安装</span> : <button onClick={() => install.mutate(plugin.id)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs text-white"><Download size={12} className="mr-1 inline" />安装</button>} />)}</div></div>}
      </section>

      <section className="mt-4 overflow-hidden rounded-[26px] border border-indigo-100 bg-indigo-50/40">
        <button onClick={() => setShowAi((v) => !v)} className="flex w-full items-center justify-between gap-4 p-5 text-left">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><Bot size={16} /></div><div><div className="text-sm font-semibold text-indigo-950">AI 与自动化</div><div className="mt-0.5 text-xs text-indigo-700">配置 OpenAI-compatible 接口，并让 AI 根据已安装插件生成自动化建议。</div></div></div>
          {showAi ? <ChevronUp size={17} className="text-indigo-400" /> : <ChevronDown size={17} className="text-indigo-400" />}
        </button>
        {showAi && <div className="grid grid-cols-2 gap-5 border-t border-indigo-100 p-5">
          <div className="rounded-2xl bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Bot size={15} />AI Provider</div><div className="mt-1 text-[10px] leading-5 text-slate-400">AI Image Caption 会把真实图片作为 image_url 视觉输入发送给模型，请选择支持视觉能力的 OpenAI-compatible 模型。</div><div className="mt-3 space-y-3">{(['baseUrl', 'model', 'apiKey'] as const).map((key) => <input key={key} type={key === 'apiKey' ? 'password' : 'text'} value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} placeholder={key} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none" />)}<button onClick={() => saveAi.mutate(settings)} className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-medium text-white">保存 AI 配置</button>{saveAi.isSuccess && <div className="text-[10px] text-emerald-600">已保存；API Key 存入系统凭据库。</div>}{saveAi.error && <div className="text-[10px] text-red-600">{String(saveAi.error)}</div>}</div></div>
          <div className="rounded-2xl bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} />AI Planner</div><div className="mt-3 flex gap-2"><input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="例如：上传后调用 Webhook 通知博客" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-xs" /><button disabled={!request || planMut.isPending} onClick={() => planMut.mutate(request)} className="grid size-10 place-items-center rounded-xl bg-slate-950 text-white disabled:opacity-30">{planMut.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Send size={14} />}</button></div>{plan && <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-950 p-3 text-[10px] leading-5 text-slate-100">{plan}</pre>}{planMut.error && <div className="mt-2 text-xs text-red-600">{String(planMut.error)}</div>}</div>
        </div>}
      </section>
    </div>
  )
}

function InstalledPluginRow({ plugin, busy, onToggle, onRevokePermissions, onToggleHook, hookLabel, onRemove, onSaved }: { plugin: PluginView; busy: boolean; onToggle: (enabled: boolean) => void; onRevokePermissions: () => void; onToggleHook: (hook: string) => void; hookLabel: (hook: string) => string; onRemove: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const hasSensitiveGrant = plugin.grantedPermissions.some((permission) => ['network', 'secret', 'external_write'].includes(permission))
  return <article className={`rounded-2xl border p-4 transition ${plugin.enabled ? 'border-emerald-100 bg-emerald-50/25' : 'border-slate-200 bg-white'}`}>
    <div className="flex items-center gap-4">
      <div className={`grid size-10 shrink-0 place-items-center rounded-2xl ${plugin.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}><Plug size={16} /></div>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><div className="truncate text-sm font-semibold">{plugin.name}</div><span className={`rounded-full px-2 py-0.5 text-[10px] ${plugin.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{plugin.enabled ? '运行中' : '已关闭'}</span></div><p className="mt-1 truncate text-xs text-slate-400">{plugin.description}</p></div>
      <button disabled={busy} onClick={() => onToggle(!plugin.enabled)} aria-pressed={plugin.enabled} className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${plugin.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}><span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all ${plugin.enabled ? 'left-6' : 'left-1'}`} /><span className="sr-only">{plugin.enabled ? '关闭' : '开启'} {plugin.name}</span></button>
    </div>
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">{plugin.permissions.map((permission) => { const granted = plugin.grantedPermissions.includes(permission); return <span key={permission} title={granted ? '已授权' : '未授权'} className={`rounded-full px-2 py-1 text-[10px] ring-1 ${granted ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-white text-slate-400 ring-slate-100'}`}>{permission}{granted ? ' ✓' : ''}</span> })}</div>
        <div className="flex items-center gap-3">{hasSensitiveGrant && <button onClick={onRevokePermissions} className="text-[11px] font-medium text-amber-600 hover:text-amber-700">撤销敏感授权</button>}<button onClick={() => setEditing((v) => !v)} className="text-[11px] font-medium text-slate-500 hover:text-slate-900">{editing ? '收起配置' : '配置'}</button><button onClick={onRemove} className="flex items-center gap-1 text-[11px] text-red-500"><Trash2 size={12} />卸载</button></div>
      </div>
      {!!plugin.supportedHooks.length && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">触发器</span>{plugin.supportedHooks.map((hook) => { const active = plugin.enabledHooks.includes(hook); return <button key={hook} disabled={busy} onClick={() => onToggleHook(hook)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium ring-1 transition disabled:opacity-40 ${active ? 'bg-indigo-50 text-indigo-700 ring-indigo-100' : 'bg-white text-slate-400 ring-slate-100'}`}>{hookLabel(hook)}{active ? ' ✓' : ''}</button> })}</div>}
    </div>
    {editing && <PluginConfig p={plugin} onSaved={onSaved} />}
  </article>
}

function PluginCard({ p, action }: { p: PluginView; action: ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{p.name}</div><div className="mt-1 text-[11px] leading-5 text-slate-400">{p.description}</div></div>{action}</div><div className="mt-3 text-[10px] text-slate-400">{p.kind} · {p.version}{p.supportedHooks.length ? ` · ${p.supportedHooks.length} 个触发点` : ''}</div></div>
}

function PluginConfig({ p, onSaved }: { p: PluginView; onSaved: () => void }) {
  const [raw, setRaw] = useState(JSON.stringify(p.config ?? {}, null, 2))
  const mutation = useMutation({ mutationFn: () => savePluginConfig(p.id, JSON.parse(raw)), onSuccess: onSaved })
  return <div className="mt-4 rounded-xl bg-white p-3 ring-1 ring-slate-100"><div className="mb-2 text-[11px] font-medium text-slate-600">插件配置 JSON</div><textarea value={raw} onChange={(e) => setRaw(e.target.value)} className="h-24 w-full rounded-xl border border-slate-200 p-3 font-mono text-[11px]" /><div className="mt-2 flex items-center"><button onClick={() => mutation.mutate()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px]">保存配置</button>{mutation.isSuccess && <CheckCircle2 size={13} className="ml-2 text-emerald-500" />}{mutation.error && <span className="ml-2 text-[10px] text-red-500">{String(mutation.error)}</span>}</div></div>
}

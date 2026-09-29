import {
  Check,
  ClipboardCopy,
  Database,
  ExternalLink,
  KeyRound,
  Keyboard,
  MousePointerClick,
  LoaderCircle,
  Network,
  RotateCcw,
  RefreshCw,
  Shield,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import {
  copyText,
  getLocalApiInfo,
  getLocalApiGuideUrl,
  getSystemDiagnostics,
  getGlobalShortcutInfo,
  getWindowsContextMenuInfo,
  getOutputPreferences,
  getTyporaIntegrationInfo,
  openAppDataDir,
  openExternalUrlOrReport,
  openTypora,
  regenerateLocalApiToken,
  setGlobalShortcutEnabled,
  installWindowsContextMenu,
  uninstallWindowsContextMenu,
  saveOutputPreferences,
} from '../lib/desktop'
import { useAppStore } from '../store/useAppStore'
import { confirmAction } from '../store/useConfirmStore'
import type { OutputFormat, OutputPreferences } from '../types'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const setPage = useAppStore((state) => state.setPage)
  const localApiGuideUrl = getLocalApiGuideUrl()
  const { data } = useQuery({ queryKey: ['output-preferences'], queryFn: getOutputPreferences })
  const { data: typora, error: typoraError, isFetching: typoraChecking, refetch: refreshTypora } = useQuery({
    queryKey: ['typora-integration'],
    queryFn: getTyporaIntegrationInfo,
    refetchOnWindowFocus: false,
  })
  const { data: localApi, error: localApiError, refetch: refreshLocalApi } = useQuery({
    queryKey: ['local-api-integration'],
    queryFn: getLocalApiInfo,
    refetchOnWindowFocus: false,
  })
  const { data: diagnostics, error: diagnosticsError, isFetching: diagnosticsChecking, refetch: refreshDiagnostics } = useQuery({
    queryKey: ['system-diagnostics'],
    queryFn: getSystemDiagnostics,
    refetchOnWindowFocus: false,
  })
  const { data: globalShortcut, error: shortcutError } = useQuery({
    queryKey: ['global-shortcut-integration'],
    queryFn: getGlobalShortcutInfo,
    refetchOnWindowFocus: false,
  })
  const { data: contextMenu } = useQuery({
    queryKey: ['windows-context-menu-integration'],
    queryFn: getWindowsContextMenuInfo,
    refetchOnWindowFocus: false,
  })
  const [form, setForm] = useState<OutputPreferences>({ defaultFormat: 'markdown', customTemplate: '![{name}]({url})', autoCopyAfterPublish: true })
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [startingTypora, setStartingTypora] = useState(false)
  const [copiedApiToken, setCopiedApiToken] = useState(false)
  const [copiedApiExample, setCopiedApiExample] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const mutation = useMutation({
    mutationFn: saveOutputPreferences,
    onSuccess: (saved) => queryClient.setQueryData(['output-preferences'], saved),
  })

  const regenerateApiTokenMutation = useMutation({
    mutationFn: regenerateLocalApiToken,
    onSuccess: (info) => queryClient.setQueryData(['local-api-integration'], info),
  })

  const shortcutMutation = useMutation({
    mutationFn: setGlobalShortcutEnabled,
    onSuccess: (info) => queryClient.setQueryData(['global-shortcut-integration'], info),
  })

  const installContextMenuMutation = useMutation({
    mutationFn: installWindowsContextMenu,
    onSuccess: (info) => queryClient.setQueryData(['windows-context-menu-integration'], info),
  })

  const uninstallContextMenuMutation = useMutation({
    mutationFn: uninstallWindowsContextMenu,
    onSuccess: (info) => queryClient.setQueryData(['windows-context-menu-integration'], info),
  })

  async function copyTyporaCommand() {
    if (!typora?.command) return
    try {
      await copyText(typora.command)
      setCopiedCommand(true)
      setActionError(null)
      window.setTimeout(() => setCopiedCommand(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function launchTypora() {
    try {
      await openTypora()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function startTyporaSetup() {
    if (!typora?.command) return
    setStartingTypora(true)
    try {
      await copyText(typora.command)
      await openTypora()
      setCopiedCommand(true)
      setActionError(null)
      window.setTimeout(() => setCopiedCommand(false), 1800)
    } catch (error) {
      setActionError(String(error))
    } finally {
      setStartingTypora(false)
    }
  }

  async function showDataDir() {
    try {
      await openAppDataDir()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function copyApiToken() {
    if (!localApi?.token) return
    try {
      await copyText(localApi.token)
      setCopiedApiToken(true)
      setActionError(null)
      window.setTimeout(() => setCopiedApiToken(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function copyApiExample() {
    if (!localApi?.token) return
    const command = `curl.exe -X POST "${localApi.pathUploadEndpoint}" -H "Authorization: Bearer ${localApi.token}" -H "Content-Type: application/json" -d "{\\"paths\\":[\\"C:/path/image.png\\"]}"`
    try {
      await copyText(command)
      setCopiedApiExample(true)
      setActionError(null)
      window.setTimeout(() => setCopiedApiExample(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function regenerateApiToken() {
    if (!(await confirmAction({ title: '重置 Local API Token', detail: '重新生成后，之前配置在 ShareX、脚本或其他工具里的 Local API Token 会立即失效。继续吗？', confirmLabel: '重置 Token' }))) return
    try {
      await regenerateApiTokenMutation.mutateAsync()
      await refreshLocalApi()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function toggleGlobalShortcut(enabled: boolean) {
    try {
      await shortcutMutation.mutateAsync(enabled)
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function toggleWindowsContextMenu() {
    try {
      if (contextMenu?.installed) await uninstallContextMenuMutation.mutateAsync()
      else await installContextMenuMutation.mutateAsync()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  return (
    <div className="mx-auto max-w-[1040px] px-10 py-9">
      <PageHeader title="设置" description="只保留真正可操作的应用设置；云端账号和密钥继续归属于对应 Storage。" />

      {actionError && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{actionError}</div>}

      <section className="mt-8 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-950"><Workflow size={17} /> Typora 集成</div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-indigo-700/70">Typora 的“自定义命令”会调用 图床自动维护的上传链，并在上传成功后依次执行当前已启用插件，再把最终公网 URL 返回给 Typora。</p>
          </div>
          <button onClick={() => void refreshTypora()} className="flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-indigo-700">
            {typoraChecking ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新检测
          </button>
        </div>

        {typoraError && (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3">
            <div className="text-xs font-medium text-red-700">无法检查 Typora 桥接状态</div>
            <div className="mt-1 text-[11px] leading-5 text-red-600">{String(typoraError).replace(/^Error:\s*/i, '')}</div>
            <button onClick={() => void refreshTypora()} className="mt-2 rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-700">重新检查</button>
          </div>
        )}
        {!typoraError && (
        <div className={`mt-4 rounded-2xl border px-4 py-3 ${typora?.ready ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 grid size-7 place-items-center rounded-lg ${typora?.ready ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {typora?.ready ? <Check size={14} /> : <LoaderCircle size={14} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{typora?.ready ? '桥接已就绪' : '还需要完成上传配置'}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-500">{typora?.message || '正在检查自动上传链与云端连接…'}</div>
              {typora?.defaultWorkflow && <div className="mt-1 text-[11px] text-slate-400">自动上传链：{typora.defaultWorkflow}</div>}
            </div>
          </div>
        </div>
        )}

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-700">Typora 自定义上传命令</div>
          <div className="mt-2 break-all rounded-xl bg-slate-950 px-3 py-3 font-mono text-[11px] leading-5 text-slate-200">{typora?.command || (typoraError ? '命令暂不可用：桥接状态读取失败' : '正在生成…')}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!typora?.command || startingTypora} onClick={() => void startTyporaSetup()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-40">
              {startingTypora ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}复制命令并打开 Typora
            </button>
            <button disabled={!typora?.command} onClick={() => void copyTyporaCommand()} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium disabled:opacity-40">
              {copiedCommand ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedCommand ? '命令已复制' : '只复制命令'}
            </button>
            <button onClick={() => void launchTypora()} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium"><ExternalLink size={14} />只打开 Typora</button>
            <button onClick={() => setPage('plugins')} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium"><Workflow size={14} />管理上传插件</button>
          </div>
          <div className="mt-2 text-[11px] leading-5 text-slate-400">“复制命令并打开 Typora”只会把 Custom Command 放进剪贴板并启动 Typora，不会自动修改 Typora 设置。请继续在 Typora → 偏好设置 → 图像中手动选择“自定义命令”、粘贴并执行一次验证。</div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-[11px] text-slate-500 max-lg:grid-cols-2">
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">1</div><div className="mt-1">点击“复制命令并打开 Typora”（命令会复制到剪贴板）</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">2</div><div className="mt-1">Typora → 偏好设置 → 图像</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">3</div><div className="mt-1">上传服务选“自定义命令”并粘贴</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">4</div><div className="mt-1">点击“验证图片上传选项”</div></div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">之后在 Typora 粘贴、拖入图片，或使用“上传所有本地图片”，都会调用 图床默认上传链，并执行当前开启的插件。图床界面不需要保持打开。</p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div className="rounded-[24px] border border-violet-100 bg-gradient-to-br from-violet-50/80 via-white to-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-950"><Keyboard size={17} /> 全局快捷上传</div>
              <p className="mt-1 text-xs leading-6 text-violet-800/70">不切换窗口：截图复制到剪贴板后按快捷键，Publisher 后台上传并把最终 URL 重新写入剪贴板。</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={globalShortcut?.enabled ?? false}
                disabled={shortcutMutation.isPending || !globalShortcut}
                onChange={(event) => void toggleGlobalShortcut(event.target.checked)}
                className="size-4 accent-violet-700"
              />启用
            </label>
          </div>
          <div className="mt-4 rounded-2xl border border-violet-100 bg-white p-4">
            <div className="text-[11px] font-medium text-slate-500">快捷键</div>
            <div className="mt-1 flex items-center justify-between gap-3"><span className="font-mono text-sm font-semibold text-slate-900">{globalShortcut?.shortcut || (shortcutError ? '读取失败' : '读取中…')}</span><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${!globalShortcut ? 'bg-slate-100 text-slate-500' : globalShortcut.registered ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{!globalShortcut ? (shortcutError ? '注册状态读取失败' : '正在检查…') : globalShortcut.registered ? '系统已注册' : '未占用系统快捷键'}</span></div>
            <div className="mt-2 text-[11px] leading-5 text-slate-400">{globalShortcut?.action || '上传剪贴板图片并复制最终 URL'}</div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-violet-800/70">{globalShortcut?.note || '复用默认 Workflow、多云策略与插件链。'}</p>
        </div>

        <div className="rounded-[24px] border border-amber-100 bg-gradient-to-br from-amber-50/80 via-white to-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-950"><MousePointerClick size={17} /> Windows 右键上传</div>
              <p className="mt-1 text-xs leading-6 text-amber-800/70">把 Publisher 安装到当前用户的图片右键菜单。无需管理员权限，右击图片即可后台发布。</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${contextMenu?.installed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {contextMenu?.installed ? '已安装' : '未安装'}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4">
            <div className="text-xs font-medium text-slate-700">{contextMenu?.label || '使用 Multi-cloud Publisher 上传'}</div>
            <div className="mt-1 text-[11px] leading-5 text-slate-400">{contextMenu?.note || '仅 Windows 桌面版可用。'}</div>
          </div>
          <button
            disabled={!contextMenu?.supported || installContextMenuMutation.isPending || uninstallContextMenuMutation.isPending}
            onClick={() => void toggleWindowsContextMenu()}
            className="mt-3 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-35"
          >
            {contextMenu?.installed ? '移除右键菜单' : '安装右键菜单'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-[24px] border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-950"><Network size={17} /> Local HTTP API</div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-sky-800/70">给 ShareX、脚本、Obsidian 插件和未来 Agent 使用的本机上传入口。它复用与 Typora 相同的默认 Workflow、插件和多云策略，不维护第二套上传逻辑。</p>
            {localApiGuideUrl && (
              <button type="button" onClick={() => openExternalUrlOrReport(localApiGuideUrl)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900">
                完整调用教程与状态码 <ExternalLink size={11} />
              </button>
            )}
          </div>
          <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${!localApi ? 'bg-slate-100 text-slate-500' : localApi.running ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{!localApi ? (localApiError ? '状态读取失败' : '正在检查服务…') : localApi.running ? '127.0.0.1 服务运行中' : '服务未监听'}</div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 max-md:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium text-slate-500">Base URL</div>
            <div className="mt-1 font-mono text-xs text-slate-800">{localApi ? localApi.baseUrl : localApiError ? '读取失败' : '正在读取本机服务信息…'}</div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">Bearer Token</div>
            <div className="mt-1 break-all rounded-xl bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-200">{localApi?.token ? '••••••••••••••••••••••••••••••••' : localApiError ? 'Token 读取失败' : '正在读取系统凭据库…'}</div>
          </div>
          <div className="flex min-w-44 flex-col gap-2">
            <button disabled={!localApi?.token} onClick={() => void copyApiToken()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-40">{copiedApiToken ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedApiToken ? 'Token 已复制' : '复制 Token'}</button>
            <button disabled={!localApi?.token} onClick={() => void copyApiExample()} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium disabled:opacity-40">{copiedApiExample ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedApiExample ? '示例已复制' : '复制调用示例'}</button>
            <button disabled={regenerateApiTokenMutation.isPending} onClick={() => void regenerateApiToken()} className="flex items-center justify-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700 disabled:opacity-40"><RotateCcw size={14} />重置 Token</button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium text-slate-700">POST /v1/upload</div><div className="mt-1 text-[11px] leading-5 text-slate-400">直接发送图片二进制，并添加 <span className="font-mono">X-Publisher-Filename</span>。适合 ShareX、自定义脚本。</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium text-slate-700">POST /v1/upload-paths</div><div className="mt-1 text-[11px] leading-5 text-slate-400">JSON 提交本机图片路径数组。适合编辑器、自动化脚本和批量工具。</div></div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-800"><Shield size={14} className="mt-0.5 shrink-0" />{localApi?.securityNote || '仅监听 127.0.0.1，上传必须携带本机 Token。'}</div>
      </section>

      <section className="mt-6 rounded-[24px] border border-slate-200/80 bg-white p-5">
        <div className="flex items-start justify-between gap-6">
          <div><div className="text-sm font-semibold">链接输出</div><div className="mt-1 text-xs text-slate-400">资源页复制按钮以及应用内自动复制使用的格式。</div></div>
          <select value={form.defaultFormat} onChange={(event) => setForm((current) => ({ ...current, defaultFormat: event.target.value as OutputFormat }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none">
            <option value="markdown">Markdown</option><option value="url">URL</option><option value="html">HTML</option><option value="bbcode">BBCode</option><option value="custom">自定义</option>
          </select>
        </div>
        <label className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <div><div className="text-xs font-medium text-slate-700">发布完成后自动复制</div><div className="mt-0.5 text-[11px] text-slate-400">真正发布成功后才复制；失败任务不会写入剪贴板。</div></div>
          <input type="checkbox" checked={form.autoCopyAfterPublish} onChange={(event) => setForm((current) => ({ ...current, autoCopyAfterPublish: event.target.checked }))} className="size-4 accent-slate-950" />
        </label>
        <div className="mt-5"><label className="text-xs font-medium text-slate-600">自定义模板</label><input value={form.customTemplate} onChange={(event) => setForm((current) => ({ ...current, customTemplate: event.target.value }))} placeholder="![{name}]({url})" className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none focus:border-slate-400" /><div className="mt-1.5 text-[11px] text-slate-400">支持 {'{url}'} 与 {'{name}'}。GitHub 会使用 Raw URL。</div></div>
        {mutation.error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{String(mutation.error)}</div>}
        <div className="mt-4 flex justify-end"><button disabled={mutation.isPending} onClick={() => mutation.mutate(form)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">保存输出设置</button></div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <button onClick={() => setPage('storages')} className="rounded-[22px] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><KeyRound size={16} /></div><div><div className="text-sm font-medium">凭据与云端</div><div className="mt-0.5 text-xs text-slate-400">管理 GitHub Token、R2 Secret 和其他 Storage</div></div></div>
          <div className="mt-4 text-xs font-medium text-indigo-600">打开云端管理 →</div>
        </button>
        <button onClick={() => void showDataDir()} className="rounded-[22px] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><Database size={16} /></div><div><div className="text-sm font-medium">本地索引数据</div><div className="mt-0.5 text-xs text-slate-400">打开 SQLite、任务状态与应用配置所在目录</div></div></div>
          <div className="mt-4 text-xs font-medium text-indigo-600">打开数据目录 →</div>
        </button>
      </section>

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

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex items-center gap-2 text-sm font-medium"><Shield size={16} /> 安全说明</div>
        <p className="mt-2 text-xs leading-6 text-slate-500">Token 与 Secret 仍然保存在系统凭据库，Typora 命令本身不包含 Token。Typora 只把本地图片路径交给 Publisher，Publisher 再读取同一套上传配置、插件开关和凭据完成上传。</p>
      </div>

      <div className="mt-6 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5"><div className="flex items-center gap-2 text-sm font-medium text-indigo-900"><Sparkles size={16} /> 现在的交互原则</div><p className="mt-2 max-w-2xl text-xs leading-6 text-indigo-700/70">不再放看起来可以点、实际却没有行为的“装饰设置”。页面上出现的按钮都对应真实操作；纯状态信息会明确以说明文本展示。</p></div>
    </div>
  )
}

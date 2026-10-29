import { assetQueryKeys } from '../features/assets/queryKeys'
import { taskQueryKeys } from '../features/tasks/queryKeys'
import { workflowQueryKeys } from '../features/workflows/queryKeys'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  CheckCircle2,
  ClipboardPaste,
  Cloud,
  Copy,
  FileImage,
  GalleryHorizontalEnd,
  Link2,
  LoaderCircle,
  UploadCloud,
  Zap,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import {
  copyText,
  getDefaultPublishTarget,
  getOutputPreferences,
  isTauriRuntime,
  listAssets,
  listStorageGroups,
  listStorages,
  listTasks,
  saveOutputPreferences,
  setDefaultPublishTarget,
} from '../lib/desktop'
import { formatPublishedAsset } from '../lib/output'
import { useAppStore } from '../store/useAppStore'
import { notifyError } from '../store/useToastStore'
import type { OutputFormat } from '../types'

const IMAGE_EXTENSIONS = new Set(['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'])
const FORMAT_LABELS: Record<OutputFormat, string> = {
  url: 'URL',
  markdown: 'Markdown',
  html: 'HTML',
  bbcode: 'BBCode',
  custom: '自定义',
}

function isImagePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.split('/').pop() ?? ''
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''
  return extension ? IMAGE_EXTENSIONS.has(extension) : false
}

function taskTone(status: string, warning: boolean) {
  if (status === 'failed') return 'text-red-600 bg-red-50'
  if (status === 'completed' && warning) return 'text-amber-700 bg-amber-50'
  if (status === 'completed') return 'text-emerald-700 bg-emerald-50'
  return 'text-blue-700 bg-blue-50'
}

export function PublishPage() {
  const queryClient = useQueryClient()
  const { openUpload, setPage } = useAppStore()
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [recentView, setRecentView] = useState<'assets' | 'tasks'>('assets')

  const { data: storages = [], isLoading: storagesLoading, error: storagesError } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const { data: groups = [], isLoading: groupsLoading, error: groupsError } = useQuery({ queryKey: ['storage-groups'], queryFn: listStorageGroups })
  const { data: target } = useQuery({ queryKey: ['default-publish-target'], queryFn: getDefaultPublishTarget })
  const { data: assets = [], isLoading: assetsLoading, error: assetsError } = useQuery({ queryKey: assetQueryKeys.publishRecent, queryFn: () => listAssets(6) })
  const { data: tasks = [], error: tasksError, isLoading: tasksLoading } = useQuery({ queryKey: taskQueryKeys.publishRecent, queryFn: () => listTasks(6), refetchInterval: 1500 })
  const { data: preferences } = useQuery({ queryKey: ['output-preferences'], queryFn: getOutputPreferences })

  const targets = useMemo(() => [
    ...storages.filter((storage) => storage.enabled).map((storage) => ({ kind: 'storage' as const, id: storage.id, name: storage.name, hint: storage.providerKey.toUpperCase() })),
    ...groups.map((group) => ({ kind: 'group' as const, id: group.id, name: group.name, hint: group.strategy === 'mirror_all' ? 'Mirror' : 'Failover' })),
  ], [groups, storages])

  const needsFirstStorage = !storagesLoading && !groupsLoading && !storagesError && !groupsError && targets.length === 0

  const targetMutation = useMutation({
    mutationFn: ({ kind, id }: { kind: 'storage' | 'group'; id: string }) => setDefaultPublishTarget(kind, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['default-publish-target'] }),
        queryClient.invalidateQueries({ queryKey: workflowQueryKeys.workflows }),
      ])
    },
  })

  const preferenceMutation = useMutation({
    mutationFn: saveOutputPreferences,
    onSuccess: (next) => queryClient.setQueryData(['output-preferences'], next),
  })

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragging(true)
        return
      }
      if (event.payload.type === 'leave') {
        setDragging(false)
        return
      }
      setDragging(false)
      const images = event.payload.paths.filter(isImagePath)
      if (images.length) openUpload('files', images)
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [openUpload])

  async function copyAsset(assetId: string) {
    const asset = assets.find((item) => item.id === assetId)
    if (!asset?.publicUrl || !preferences) return
    try {
      await copyText(formatPublishedAsset(asset.name, asset.publicUrl, preferences))
      setCopied(assetId)
      window.setTimeout(() => setCopied((current) => current === assetId ? null : current), 1200)
    } catch (error) {
      notifyError(`复制失败：${String(error)}`)
    }
  }

  return (
    <div className="publish-workspace mx-auto max-w-[1320px] px-5 py-6 sm:px-7 lg:px-10 lg:py-9">
      <PageHeader
        title="发布"
        description="上传本地图片、截图或图片链接；Typora 也使用相同的默认云端和插件处理设置。"
        action={
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
            <UploadCloud size={14} /> 多种来源，统一发布流程
          </div>
        }
      />

      <section className="sky-welcome" aria-label="镜云发布工作台">
        <div className="sky-welcome-copy">
          <span className="sky-eyebrow">MIRROR CLOUD / YOUR CREATIVE SPACE</span>
          <h2>把灵感，寄给云端<span aria-hidden="true"> ✧</span></h2>
          <p>一张图片，一个故事。连接喜欢的云端，让分享轻盈一点。</p>
          <button onClick={() => openUpload('files')} className="sky-welcome-action"><UploadCloud size={16} />开始发布<span aria-hidden="true"> ↗</span></button>
        </div>
      </section>

      {needsFirstStorage && (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5">
          <div>
            <h2 className="text-sm font-semibold text-indigo-950">先连接一个云端，再发布第一张图片</h2>
            <p className="mt-1 text-xs leading-5 text-indigo-800">
              在“云端”添加并测试存储连接，设为默认目标后上传测试图片。上传成功后，请在“资源”或“图库”核对图片及访问方式。
            </p>
          </div>
          <button onClick={() => setPage('storages')} className="rounded-xl bg-indigo-950 px-4 py-2.5 text-xs font-semibold text-white">
            去添加存储 →
          </button>
        </section>
      )}
      <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,.04)]">
          <button
            onClick={() => openUpload('files')}
            className={`group m-5 grid min-h-[300px] w-[calc(100%-2.5rem)] place-items-center rounded-[28px] border-2 border-dashed p-8 text-center transition ${dragging ? 'border-blue-400 bg-blue-50 ring-8 ring-blue-50/70' : 'border-slate-200 bg-slate-50/55 hover:border-indigo-300 hover:bg-indigo-50/35'}`}
          >
            <div>
              <div className={`mx-auto grid size-20 place-items-center rounded-[28px] text-white shadow-xl transition group-hover:-translate-y-1 group-hover:rotate-3 ${dragging ? 'bg-blue-500' : 'bg-gradient-to-br from-slate-950 to-indigo-600'}`}>
                <UploadCloud size={34} />
              </div>
              <h2 className="mt-6 text-xl font-semibold tracking-[-0.03em]">{dragging ? '松开即可加入发布队列' : '把图片拖到这里'}</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">或点击选择文件。提交前可核对文件列表，再执行图片处理、上传和结果确认。</p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200"><FileImage size={16} />选择图片</div>
            </div>
          </button>

          <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2">
            <button onClick={() => openUpload('clipboard')} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50">
              <div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><ClipboardPaste size={17} /></div>
              <div><div className="text-sm font-medium">剪贴板</div><div className="mt-0.5 text-[11px] text-slate-400">从剪贴板选择图片</div></div>
            </button>
            <button onClick={() => openUpload('urls')} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50">
              <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Link2 size={17} /></div>
              <div><div className="text-sm font-medium">图片 URL</div><div className="mt-0.5 text-[11px] text-slate-400">批量下载再发布</div></div>
            </button>
          </div>
        </section>

        <aside className="space-y-5" aria-label="发布辅助配置">
          <section aria-label="发布目标" className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,.03)]">
          <div className="p-5">
            {(storagesLoading || groupsLoading) && <p role="status" className="mb-3 text-xs text-slate-600">正在读取可用云端…</p>}
            {(storagesError || groupsError) && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">云端列表读取失败，请到「云端」页面检查连接。</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">当前发布目标</div>
                <div className="mt-1 flex items-center gap-2 text-base font-semibold">
                  <Cloud size={17} className="text-indigo-500" />
                  {target?.name || '尚未配置默认云端'}
                </div>
              </div>
              <button onClick={() => setPage('storages')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">管理云端</button>
            </div>
            {targetMutation.error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">切换发布目标失败：{String(targetMutation.error)}</div>}
            {targets.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {targets.slice(0, 8).map((item) => {
                  const active = target?.kind === item.kind && target.id === item.id
                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      disabled={targetMutation.isPending}
                      onClick={() => targetMutation.mutate({ kind: item.kind, id: item.id })}
                      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition ${active ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      {active && <CheckCircle2 size={13} />}
                      <span>{item.name}</span>
                      <span className={active ? 'text-white/55' : 'text-slate-400'}>{item.hint}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          </section>
          <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.03)]">
            <div className="flex items-center gap-2 text-sm font-semibold"><Zap size={15} className="text-amber-500" />输出与复制</div>
            <p className="mt-1 text-xs leading-5 text-slate-400">公开图片上传后可复制链接或 Markdown；私有图片请到“资源”生成限时分享。</p>
            {preferences && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(Object.keys(FORMAT_LABELS) as OutputFormat[]).map((format) => (
                    <button
                      key={format}
                      onClick={() => preferenceMutation.mutate({ ...preferences, defaultFormat: format })}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium ${preferences.defaultFormat === format ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >{FORMAT_LABELS[format]}</button>
                  ))}
                </div>
                <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <span>发布完成自动复制</span>
                  <input
                    type="checkbox"
                    checked={preferences.autoCopyAfterPublish}
                    onChange={(event) => preferenceMutation.mutate({ ...preferences, autoCopyAfterPublish: event.target.checked })}
                  />
                </label>
              </>
            )}
          </section>

        </aside>
      </div>
      <section aria-label="最近活动" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="最近活动类型" className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button type="button" id="recent-assets-tab" aria-pressed={recentView === 'assets'} aria-controls="recent-assets-panel" onClick={() => setRecentView('assets')} className={`rounded-lg px-4 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${recentView === 'assets' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>最近发布</button>
            <button type="button" id="recent-tasks-tab" aria-pressed={recentView === 'tasks'} aria-controls="recent-tasks-panel" onClick={() => setRecentView('tasks')} className={`rounded-lg px-4 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${recentView === 'tasks' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>最近任务</button>
          </div>
          <button type="button" onClick={() => setPage(recentView === 'assets' ? 'assets' : 'tasks')} className="text-xs font-medium text-indigo-700 hover:underline">查看全部{recentView === 'assets' ? '资源' : '任务'} →</button>
        </div>
        {recentView === 'assets' && (
          <div role="region" id="recent-assets-panel" aria-label="最近发布列表">
          <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.03)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold"><GalleryHorizontalEnd size={15} className="text-indigo-500" />最近发布</div>
              <button onClick={() => setPage('assets')} className="text-[11px] font-medium text-indigo-600">全部资源</button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {assetsLoading && <p role="status" className="rounded-xl bg-slate-50 px-3 py-6 text-xs text-slate-600">正在读取最近发布…</p>}
              {assetsError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-6 text-xs text-red-700">最近发布读取失败，请前往资源页查看或重试。</p>}
              {!assetsLoading && !assetsError && !assets.length && <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">发布第一张图片后会显示在这里</div>}
              {assets.slice(0, 4).map((asset) => (
                <div key={asset.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">{asset.publicUrl ? <img src={asset.publicUrl} alt="" loading="lazy" className="size-full object-cover" /> : <FileImage size={17} />}</div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{asset.name}</div><div className="mt-0.5 text-[10px] text-slate-400">{asset.status === 'online' ? '已上传（访问待核对）' : asset.status === 'partial' ? '部分副本异常' : '失败'}</div></div>
                  <button disabled={!asset.publicUrl || !preferences} onClick={() => void copyAsset(asset.id)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-20" title={asset.publicUrl ? "按当前格式复制公开链接" : "无公开链接，请到资源页查看分享方式"} aria-label={asset.publicUrl ? `复制 ${asset.name} 的公开链接` : `${asset.name} 没有公开链接`}><Copy size={13} /></button>
                  {copied === asset.id && <span className="text-[10px] text-emerald-600">已复制</span>}
                </div>
              ))}
            </div>
          </section>
          </div>
        )}
        {recentView === 'tasks' && (
          <div role="region" id="recent-tasks-panel" aria-label="最近任务列表">
          <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.03)]">
            <div className="flex items-center justify-between"><div className="text-sm font-semibold">最近任务</div><button onClick={() => setPage('tasks')} className="text-[11px] font-medium text-indigo-600">任务中心</button></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {tasksLoading && <p role="status" className="text-xs text-slate-600">正在读取最近任务…</p>}
              {tasksError && <p role="alert" className="text-xs text-red-700">最近任务读取失败，请前往任务中心核对。</p>}
              {!tasksLoading && !tasksError && !tasks.length && <div className="text-xs text-slate-500">暂无任务</div>}
              {tasks.slice(0, 4).map((task) => (
                <div key={task.id} className="flex items-start gap-2 rounded-xl border border-slate-100 p-3">
                  {task.status === 'running' || task.status === 'preparing' || task.status === 'queued'
                    ? <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-blue-500" />
                    : <span className={`mt-0.5 size-2 shrink-0 rounded-full ${task.status === 'failed' ? 'bg-red-500' : task.error ? 'bg-amber-500' : 'bg-emerald-500'}`} />}
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{task.title}</div><div className={`mt-1 line-clamp-2 rounded-lg px-2 py-1 text-[10px] ${taskTone(task.status, Boolean(task.error))}`}>{task.error || task.detail}</div></div>
                </div>
              ))}
            </div>
          </section>
          </div>
        )}
      </section>
    </div>
  )
}

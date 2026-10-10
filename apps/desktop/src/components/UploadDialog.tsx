import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  FileImage,
  FolderOpen,
  Link2,
  LoaderCircle,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  chooseImageFiles,
  isTauriRuntime,
  listStorages,
  listTasks,
  listWorkflows,
  publishClipboardImageWithWorkflow,
  publishFilesWithWorkflow,
  publishUrlsWithWorkflow,
} from '../lib/desktop'
import { useAppStore } from '../store/useAppStore'
import { confirmAction } from '../store/useConfirmStore'
import type { PageKey, TaskView, UploadMode } from '../types'

const IMAGE_EXTENSIONS = new Set(['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

type TaskProgressEvent = { id: string; status: TaskView['status']; progress: number; error?: string | null }
type PublishRequest = { workflowId: string; mode: UploadMode; sources: string[] }
type PublishSubmission = { request: PublishRequest; taskIds: string[] }
type FailedRetryRequest = { submission: PublishSubmission; failedIndexes: number[] }


function isImagePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.split('/').pop() ?? ''
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''
  return extension ? IMAGE_EXTENSIONS.has(extension) : false
}

function displayName(path: string) {
  return path.replaceAll('\\', '/').split('/').pop() || path
}

function parseUrls(value: string) {
  return Array.from(new Set(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ))
}

export function UploadDialog() {
  const { uploadOpen, setUploadOpen, setPage, requestedUploadMode, queuedUploadPaths, clearQueuedUploadPaths } = useAppStore()
  const queryClient = useQueryClient()
  const { data: workflows = [], error: workflowError } = useQuery({ queryKey: ['workflows'], queryFn: listWorkflows, enabled: uploadOpen })
  const { data: storages = [] } = useQuery({ queryKey: ['storages'], queryFn: listStorages, enabled: uploadOpen })
  const [paths, setPaths] = useState<string[]>([])
  const [urlsText, setUrlsText] = useState('')
  const [mode, setMode] = useState<UploadMode>('files')
  const [dragging, setDragging] = useState(false)
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [submission, setSubmission] = useState<PublishSubmission | null>(null)
  // Synchronous guards also cover the gap before React Query updates isPending.
  const publishDispatchRef = useRef(false)
  const retryDispatchRef = useRef(false)
  const dialogGenerationRef = useRef(0)
  const [finishedHandled, setFinishedHandled] = useState(false)

  const { data: allTasks = [], error: tasksError, refetch: refetchTasks, isFetching: refreshingTasks } = useQuery({
    queryKey: ['tasks'],
    // A batch can contain more than the default 100 tasks. Leave headroom for
    // unrelated background jobs created after this batch was dispatched.
    queryFn: () => listTasks(Math.min(10_000, Math.max(300, taskIds.length * 5))),
    enabled: uploadOpen && taskIds.length > 0,
    // Progress normally arrives through task://updated; this slower interval only backstops a
    // missed event so a stalled bar cannot hide a finished upload.
    refetchInterval: taskIds.length > 0 ? 2000 : false,
  })

  useEffect(() => {
    if (!uploadOpen || taskIds.length === 0 || !isTauriRuntime()) return
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<TaskProgressEvent>('task://updated', (event) => {
        const payload = event.payload
        if (!taskIds.includes(payload.id)) return
        queryClient.setQueryData<TaskView[]>(['tasks'], (current) =>
          current?.map((task) => task.id === payload.id
            ? { ...task, status: payload.status, progress: payload.progress, error: payload.error ?? task.error }
            : task),
        )
      }).then((cleanup) => { unlisten = cleanup }),
    )
    return () => unlisten?.()
  }, [uploadOpen, taskIds, queryClient])

  const defaultWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.isDefault),
    [workflows],
  )

  const trackedTasks = useMemo(
    () => taskIds.map((id) => allTasks.find((task) => task.id === id)).filter(Boolean),
    [allTasks, taskIds],
  )
  const terminal = taskIds.length > 0 && trackedTasks.length === taskIds.length && trackedTasks.every((task) => task && TERMINAL_STATUSES.has(task.status))
  const failedTasks = trackedTasks.filter((task) => task?.status === 'failed')
  const warningTasks = trackedTasks.filter((task) => task?.status === 'completed' && Boolean(task?.error))
  // Each task ID is paired with the exact source submitted to Rust (same order).
  // A failed-only retry MUST NOT re-publish successful or completed-with-warning tasks.
  const failedIndexes = submission?.taskIds.flatMap((id, index) =>
    allTasks.find((task) => task.id === id)?.status === 'failed' ? [index] : [],
  ) ?? []
  const failedOnlyAvailable = terminal && Boolean(submission)
    && submission?.request.mode !== 'clipboard'
    && submission?.request.sources.length === submission?.taskIds.length
    && failedIndexes.length > 0
  const progress = taskIds.length > 0
    ? Math.round(taskIds.reduce((sum, id) => sum + (allTasks.find((task) => task.id === id)?.progress ?? 0), 0) / taskIds.length)
    : 0
  const publishing = publishMutationState(taskIds, terminal)

  useEffect(() => {
    if (!uploadOpen) return
    setMode(requestedUploadMode)
    if (queuedUploadPaths.length > 0) {
      setPaths((current) => Array.from(new Set([...current, ...queuedUploadPaths.filter(isImagePath)])))
      clearQueuedUploadPaths()
    }
  }, [clearQueuedUploadPaths, queuedUploadPaths, requestedUploadMode, uploadOpen])

  useEffect(() => {
    if (!uploadOpen || !isTauriRuntime() || mode !== 'files' || taskIds.length > 0) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
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
        if (images.length > 0) setPaths((current) => Array.from(new Set([...current, ...images])))
      })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
    return () => {
      disposed = true
      unlisten?.()
      setDragging(false)
    }
  }, [mode, taskIds.length, uploadOpen])

  useEffect(() => {
    if (!terminal || finishedHandled) return
    setFinishedHandled(true)
    void queryClient.invalidateQueries({ queryKey: ['assets'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }, [finishedHandled, queryClient, terminal])

  const urls = useMemo(() => parseUrls(urlsText), [urlsText])

  const publishMutation = useMutation({
    // Pin the chosen workflow, mode and source order at the moment of submission.
    // Later UI changes cannot silently change the contents of a retry.
    mutationFn: async (request: PublishRequest) => {
      if (request.mode === 'urls') return publishUrlsWithWorkflow(request.workflowId, request.sources)
      if (request.mode === 'clipboard') return [await publishClipboardImageWithWorkflow(request.workflowId)]
      return publishFilesWithWorkflow(request.workflowId, request.sources)
    },
    onMutate: () => {
      setSubmission(null)
      setTaskIds([])
      setFinishedHandled(false)
    },
    onSuccess: async (ids, request) => {
      setSubmission({ request, taskIds: ids })
      setTaskIds(ids)
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onSettled: () => { publishDispatchRef.current = false },
  })

  const retryFailedMutation = useMutation({
    mutationFn: async ({ submission: previous, failedIndexes }: FailedRetryRequest) => {
      const { workflowId, mode, sources } = previous.request
      const failedSources = failedIndexes.map((index) => sources[index])
      if (mode === 'files') return publishFilesWithWorkflow(workflowId, failedSources)
      if (mode === 'urls') return publishUrlsWithWorkflow(workflowId, failedSources)
      throw new Error('剪贴板图片无法保证与之前的内容相同，不能自动重试')
    },
    onSuccess: async (ids, { submission: previous, failedIndexes }) => {
      if (ids.length !== failedIndexes.length) {
        // Never guess which source belongs to a task if the backend violates its
        // one-source/one-task contract. The task center still shows queued jobs.
        setSubmission(null)
        setTaskIds([])
        return
      }
      const updated = [...previous.taskIds]
      failedIndexes.forEach((index, i) => { updated[index] = ids[i] })
      setSubmission({ request: previous.request, taskIds: updated })
      setTaskIds(updated)
      setFinishedHandled(false)
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onSettled: () => { retryDispatchRef.current = false },
  })

  async function retryFailedOnly() {
    // A rejected IPC call can still leave queued tasks. Never offer a second
    // failed-only replay until the user checks Tasks and starts a fresh session.
    if (!failedOnlyAvailable || !submission || retryDispatchRef.current || retryFailedMutation.isError || retryFailedMutation.isPending || publishMutation.isPending) return
    retryDispatchRef.current = true
    const generation = dialogGenerationRef.current
    let accepted = false
    try {
      accepted = await confirmAction({
      title: `仅重新发布 ${failedIndexes.length} 个失败项？`,
      detail: '已成功项目和已完成但有警告的项目不会重新上传。失败任务也可能已向部分云端写入文件；重新发布可能产生重复对象或副本，请先检查任务和资源记录。此操作不会复用旧任务状态。',
      confirmLabel: `确认重新发布 ${failedIndexes.length} 项`,
      danger: true,
      })
    } catch {
      retryDispatchRef.current = false
      return
    }
    if (!accepted || generation !== dialogGenerationRef.current || retryFailedMutation.isPending) {
      retryDispatchRef.current = false
      return
    }
    retryFailedMutation.mutate({ submission, failedIndexes: [...failedIndexes] })
  }

  async function startPublish() {
    if (!defaultWorkflow || !canPublish || publishMutation.isPending || publishDispatchRef.current) return
    publishDispatchRef.current = true
    const generation = dialogGenerationRef.current
    if (publishMutation.isError) {
      // A failed multi-source command might have queued some earlier sources.
      // Require an explicit decision instead of silently replaying the batch.
      let accepted = false
      try {
        accepted = await confirmAction({
          title: '上次提交状态不确定，仍要再次发布？',
          detail: '之前的提交虽然返回错误，但部分图片可能已经开始上传。请先到任务中心核对；重新提交可能产生重复资源。',
          confirmLabel: '我已检查，仍要发布',
          danger: true,
        })
      } catch {
        publishDispatchRef.current = false
        return
      }
      if (!accepted || generation !== dialogGenerationRef.current) {
        publishDispatchRef.current = false
        return
      }
    }
    publishMutation.mutate({
      workflowId: defaultWorkflow.id,
      mode,
      sources: mode === 'files' ? [...paths] : mode === 'urls' ? [...urls] : [],
    })
  }

  if (!uploadOpen) return null

  async function pickImages() {
    const chosen = await chooseImageFiles()
    if (chosen.length > 0) setPaths((current) => Array.from(new Set([...current, ...chosen.filter(isImagePath)])))
  }

  function removeSelectedFile(path: string) {
    if (publishMutation.isPending || publishDispatchRef.current) return
    setPaths((current) => current.filter((item) => item !== path))
  }

  function resetPublish() {
    dialogGenerationRef.current += 1
    setTaskIds([])
    setSubmission(null)
    setFinishedHandled(false)
    publishMutation.reset()
    retryFailedMutation.reset()
  }

  function closeDialog() {
    if ((publishing && !terminal) || publishMutation.isPending || retryFailedMutation.isPending) return
    resetPublish()
    setPaths([])
    setUrlsText('')
    setDragging(false)
    setUploadOpen(false)
  }

  function startAnother() {
    setPaths([])
    setUrlsText('')
    resetPublish()
  }

  function leaveDialog(nextPage: PageKey) {
    resetPublish()
    setPaths([])
    setUrlsText('')
    setDragging(false)
    setUploadOpen(false)
    setPage(nextPage)
  }

  const selectedWorkflow = defaultWorkflow
  const selectedStorage = selectedWorkflow?.targetKind === 'storage'
    ? storages.find((storage) => storage.id === selectedWorkflow.targetId)
    : undefined
  const canPublish = Boolean(defaultWorkflow) && (mode === 'files' ? paths.length > 0 : mode === 'urls' ? urls.length > 0 : true)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-sm" onMouseDown={closeDialog}>
      <section className="max-h-[92vh] w-full max-w-[720px] overflow-auto rounded-[28px] border border-white bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,.18)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between p-2">
          <div><h2 className="text-xl font-semibold">发布资源</h2><p className="mt-1 text-sm text-slate-400">提交后不会直接消失；这里会持续显示处理、上传和最终结果。</p></div>
          <button disabled={(publishing && !terminal) || publishMutation.isPending || retryFailedMutation.isPending} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-25" onClick={closeDialog} aria-label="关闭"><X size={18} /></button>
        </div>

        {taskIds.length === 0 ? (
          <>
            <div className="mt-3 inline-flex rounded-xl bg-slate-100 p-1">
              <button onClick={() => { setMode('files') }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${mode === 'files' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><FileImage size={14} />本地文件</button>
              <button onClick={() => { setMode('urls') }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${mode === 'urls' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Link2 size={14} />图片 URL</button>
              <button onClick={() => { setMode('clipboard') }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${mode === 'clipboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><ClipboardPaste size={14} />剪贴板</button>
            </div>

            {mode === 'files' ? (
              <>
                <button onClick={pickImages} className={`mt-3 grid min-h-[210px] w-full place-items-center rounded-[24px] border border-dashed p-6 text-center transition ${dragging ? 'border-blue-400 bg-blue-50 ring-4 ring-blue-50' : 'border-slate-250 bg-slate-50/70 hover:bg-slate-50'}`}>
                  <div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white shadow-sm"><Upload size={20} /></div><div className="mt-4 text-sm font-medium">{dragging ? '松开即可添加图片' : '把图片拖到这里，或点击选择'}</div><div className="mt-1 text-xs text-slate-400">JPEG / PNG / WebP / GIF / BMP · 选择后核对列表，可逐张移除。</div><div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"><FolderOpen size={15} />选择文件</div></div>
                </button>
                {paths.length > 0 && (
                  <div className="mt-4 max-h-44 overflow-auto rounded-2xl border border-slate-200 p-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>已选择 {paths.length} 张</span>
                      <button disabled={publishMutation.isPending} onClick={() => setPaths([])} className="hover:text-slate-700 disabled:opacity-40">清空</button>
                    </div>
                    {paths.map((path) => (
                      <div key={path} className="flex items-center gap-2 py-1.5 text-xs text-slate-600">
                        <FileImage size={14} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate" title={path}>{displayName(path)}</span>
                        <button type="button" disabled={publishMutation.isPending} onClick={() => removeSelectedFile(path)}
                          aria-label={`移除 ${displayName(path)}`} title="从本次上传列表移除，不删除本地文件"
                          className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : mode === 'urls' ? (
              <div className="mt-3 rounded-[24px] border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Link2 size={16} />从 URL 发布</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">每行一个 http/https 图片地址。下载后仍执行内部处理链和已启用插件。</p>
                <textarea value={urlsText} onChange={(event) => setUrlsText(event.target.value)} placeholder={'https://example.com/a.png\nhttps://example.com/b.jpg'} className="mt-3 min-h-36 w-full resize-y rounded-2xl border border-slate-200 bg-white p-3 font-mono text-xs leading-6 outline-none focus:border-slate-400" />
                <div className="mt-2 text-[11px] text-slate-400">已识别 {urls.length} 个 URL</div>
              </div>
            ) : (
              <div className="mt-3 grid min-h-[210px] place-items-center rounded-[24px] border border-slate-200 bg-slate-50/60 p-6 text-center">
                <div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white shadow-sm"><ClipboardPaste size={20} /></div><div className="mt-4 text-sm font-medium">发布系统剪贴板中的图片</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-400">截图或复制图片后直接发布，仍使用下面的上传目标，并执行已启用插件。</p></div>
              </div>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between"><label className="text-xs font-medium text-slate-500">当前自动上传链</label><button onClick={() => leaveDialog('storages')} className="text-[11px] font-medium text-indigo-600">更换默认云端 →</button></div>
              {workflowError && <div className="mt-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">自动上传链同步失败：{String(workflowError)}</div>}
              {selectedWorkflow ? <div className="mt-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-indigo-900">{selectedWorkflow.targetName}</div><div className="mt-1 text-[11px] text-indigo-700">图片处理：{selectedWorkflow.format.toUpperCase()} · Q{selectedWorkflow.quality}{selectedWorkflow.maxWidth ? ` · 最大 ${selectedWorkflow.maxWidth}px` : ''}</div></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-indigo-600">自动</span></div>
                {selectedStorage?.accessMode === 'private_requested' ? (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">当前目标请求私有存储：上传成功后不会产生永久公开 URL，请到“资源”生成限时分享。Bucket 是否真正禁止公开访问尚未验证；Typora/CLI 无法使用此目标。</div>
                ) : (
                  <div className="mt-2 text-[11px] text-slate-400">上传成功后会按“插件”页面当前开关依次执行插件；本地文件、URL、剪贴板和 Typora 共用这一条链。</div>
                )}
              </div> : <div className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">还没有默认上传目标。先到“云端”连接一个存储，系统会自动创建上传链。</div>}
              {!storages.length && <div className="mt-2 text-xs text-amber-600">请先到“云端”连接至少一个存储。</div>}
            </div>

            {publishMutation.error && <div role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-600"><div className="font-medium">提交失败，部分任务状态可能不确定</div><div className="mt-1">{String(publishMutation.error)}</div><div className="mt-1 text-red-700">请先在任务中心检查是否已有任务开始运行。再次点击发布会要求确认，不能假设之前没有上传。</div></div>}
            <div className="mt-5 flex justify-end"><button disabled={!canPublish || publishMutation.isPending} onClick={startPublish} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-30">{publishMutation.isPending && <LoaderCircle size={15} className="animate-spin" />}{publishMutation.isPending ? '检查目标…' : mode === 'urls' ? `发布 ${urls.length || ''} 个 URL` : mode === 'clipboard' ? '发布剪贴板图片' : '开始发布'}</button></div>
          </>
        ) : (
          <div className="mt-4">
            <div className={`rounded-[22px] border p-5 ${failedTasks.length ? 'border-red-100 bg-red-50/40' : terminal && warningTasks.length ? 'border-amber-100 bg-amber-50/40' : terminal ? 'border-emerald-100 bg-emerald-50/40' : 'border-blue-100 bg-blue-50/40'}`}>
              <div className="flex items-center gap-3">
                <div className={`grid size-10 place-items-center rounded-2xl ${failedTasks.length ? 'bg-red-100 text-red-600' : terminal && warningTasks.length ? 'bg-amber-100 text-amber-600' : terminal ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                  {terminal ? (failedTasks.length ? <AlertCircle size={18} /> : warningTasks.length ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />) : <LoaderCircle size={18} className="animate-spin" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{terminal ? (failedTasks.length ? '发布完成，但有失败项' : warningTasks.length ? '发布完成，但有警告' : '发布完成') : '正在上传并执行已启用插件'}</div>
                  <div className="mt-1 text-xs text-slate-500">{terminal ? `${failedTasks.length} 失败 · ${warningTasks.length} 警告 · ${trackedTasks.length - failedTasks.length - warningTasks.length} 正常` : `处理中 · ${progress}%`}</div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-700">{progress}%</div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80"><div className={`h-full rounded-full transition-all duration-300 ${failedTasks.length ? 'bg-red-500' : terminal && warningTasks.length ? 'bg-amber-500' : terminal ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${Math.max(2, progress)}%` }} /></div>
            </div>

            {tasksError && (
              <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <span>任务状态读取失败，进度可能不是最新结果。不要因此重复提交图片。</span>
                <button type="button" disabled={refreshingTasks} onClick={() => void refetchTasks()}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium disabled:opacity-40">
                  {refreshingTasks ? '刷新中…' : '重新读取任务'}
                </button>
              </div>
            )}
            <div className="mt-4 max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-white">
              {taskIds.map((id, index) => {
                const task = allTasks.find((item) => item.id === id)
                return <div key={id} className={`flex items-start gap-3 p-3 ${index ? 'border-t border-slate-100' : ''}`}>
                  <div className="mt-0.5">{task?.status === 'failed' ? <AlertCircle size={15} className="text-red-500" /> : task?.status === 'completed' && task?.error ? <TriangleAlert size={15} className="text-amber-500" /> : task?.status === 'completed' ? <CheckCircle2 size={15} className="text-emerald-500" /> : <LoaderCircle size={15} className="animate-spin text-blue-500" />}</div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{task?.title || `任务 ${index + 1}`}</div><div className={`mt-1 text-[11px] leading-5 ${task?.status === 'failed' ? 'text-red-500' : task?.status === 'completed' && task?.error ? 'text-amber-600' : 'text-slate-400'}`}>{task?.error || task?.detail || '等待任务引擎…'}</div></div>
                  <span className="text-[11px] tabular-nums text-slate-400">{task?.progress ?? 0}%</span>
                </div>
              })}
            </div>

            {!terminal && <div className="mt-3 text-center text-[11px] text-slate-400">窗口会保持打开。你也可以切到“任务”页面查看后台状态。</div>}
            {terminal && failedTasks.length > 0 && <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              只允许重新发布失败项；成功项和完成但有警告的项不会再次提交。部分云端可能已经收到失败任务的数据，重新发布前请确认重复对象风险。
            </div>}
            {retryFailedMutation.error && <div role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
              失败项重新提交未成功，可能已有新任务运行。为避免重复发布，本次会话已禁用再次重试；请先到任务中心核对后重新选择输入。
            </div>}
            {terminal && <div className="mt-5 flex flex-wrap justify-end gap-2">
              {failedOnlyAvailable && <button disabled={retryFailedMutation.isPending || retryFailedMutation.isError}
                onClick={() => void retryFailedOnly()}
                className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 disabled:opacity-40">
                {retryFailedMutation.isPending ? '重新提交失败项…' : `仅重试失败的 ${failedIndexes.length} 项`}
              </button>}
              {failedTasks.length > 0 && submission?.request.mode === 'clipboard' &&
                <p className="w-full text-right text-xs text-amber-700">剪贴板内容可能已变化，请使用“继续发布”手动重新提交。</p>}
              <button disabled={retryFailedMutation.isPending} onClick={startAnother} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium">继续发布</button>
              <button disabled={retryFailedMutation.isPending} onClick={() => leaveDialog('tasks')} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium">查看任务</button>
              <button disabled={retryFailedMutation.isPending} onClick={() => leaveDialog('assets')} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">查看资源</button>
            </div>}
          </div>
        )}
      </section>
    </div>
  )
}

function publishMutationState(taskIds: string[], terminal: boolean) {
  return taskIds.length > 0 && !terminal
}

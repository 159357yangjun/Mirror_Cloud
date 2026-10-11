import {
  ChevronLeft,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  Grid2X2,
  Image as ImageIcon,
  List,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { notifySuccess } from '../store/useToastStore'
import { confirmAction } from '../store/useConfirmStore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { GalleryMediaCard } from '../components/GalleryMediaCard'
import { canPreviewCloudImage, isPrivateS3Storage, useCloudImagePreview } from '../lib/useCloudImagePreview'
import { browseStorage, chooseDownloadPath, copyText, createStorageDirectory, createTemporaryShareLink, deleteStorageEntry, downloadStorageEntry, listStorages, moveStorageEntry, openExternalUrlOrReport, queueBatchDeleteStorageEntries, queueBatchMoveStorageEntries, queueBatchRenameStorageEntries } from '../lib/desktop'
import type { StorageEntryView } from '../types'

function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function joinRemotePath(parent: string, name: string) {
  const cleanParent = parent.split('/').filter(Boolean).join('/')
  const cleanName = name.trim().replace(/^\/+|\/+$/g, '')
  return cleanParent ? `${cleanParent}/${cleanName}` : cleanName
}

function sizeLabel(size?: number | null) {
  if (size == null) return ''
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function isImage(entry: StorageEntryView) {
  if (entry.isDir) return false
  const source = `${entry.name} ${entry.publicUrl || ''}`.toLowerCase().split('?')[0]
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].some((extension) =>
    source.endsWith(extension) || source.includes(`${extension} `),
  )
}

const GALLERY_PAGE_SIZE = 120
// Revealed batches stay mounted, so an unbounded "继续显示" leaves the page scrolling through
// thousands of live nodes. Beyond this many, a large leftover is reported instead of offered.
const GALLERY_RENDER_CAP = 600

export function GalleryPage() {
  const queryClient = useQueryClient()
  const { data: storages = [], isLoading: loadingStorages } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const [storageId, setStorageId] = useState('')
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [visibleCount, setVisibleCount] = useState(GALLERY_PAGE_SIZE)
  const { preview, previewingPath, previewError, openPreview, closePreview } = useCloudImagePreview()
  const [shareExpiry, setShareExpiry] = useState<600 | 3600 | 86400>(600)
  const [copied, setCopied] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [pathDialog, setPathDialog] = useState<{ mode: 'create' | 'rename' | 'move' | 'batch_move' | 'batch_rename'; entry?: StorageEntryView; value: string } | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)

  useEffect(() => {
    if (!storageId && storages[0]) setStorageId(storages[0].id)
    if (storageId && !storages.some((storage) => storage.id === storageId)) {
      setStorageId(storages[0]?.id || '')
      setPath('')
    }
  }, [storageId, storages])

  useEffect(() => {
    setSelectedPaths(new Set())
    closePreview()
  }, [storageId, path, closePreview])

  const storage = storages.find((item) => item.id === storageId)
  const privateS3 = isPrivateS3Storage(storage)
  const { data: entries = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['gallery-storage', storageId, path],
    queryFn: () => browseStorage(storageId, path),
    enabled: Boolean(storageId),
  })

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) => entry.name.toLowerCase().includes(keyword) || entry.path.toLowerCase().includes(keyword))
  }, [entries, search])

  const imageCount = filtered.filter(isImage).length

  // A cloud directory can hold thousands of entries; rendering all of them at once makes the
  // gallery unscrollable on slow machines, so each batch is revealed on demand.
  useEffect(() => {
    setVisibleCount(GALLERY_PAGE_SIZE)
  }, [path, search, storageId])

  const visibleEntries = filtered.length > visibleCount ? filtered.slice(0, visibleCount) : filtered
  const hiddenCount = filtered.length - visibleEntries.length
  // Soft cap: a small leftover is simply handed over instead of scaring the user with a limit
  // message, so the worst case is one batch past the cap.
  const revealCapped = visibleCount >= GALLERY_RENDER_CAP && hiddenCount > GALLERY_PAGE_SIZE

  async function copyUrl(entry: StorageEntryView) {
    if (privateS3 || !entry.publicUrl) return
    await copyText(entry.publicUrl)
    setCopied(entry.path)
    window.setTimeout(() => setCopied((current) => current === entry.path ? null : current), 1200)
  }

  async function shareEntry(entry: StorageEntryView) {
    if (!privateS3 || !storageId || entry.isDir || busyPath !== null) return
    setActionError(null)
    setBusyPath(entry.path)
    try {
      const url = await createTemporaryShareLink(storageId, entry.path, shareExpiry)
      await copyText(url)
      notifySuccess('限时只读链接已复制。持有链接者在有效期内可以访问，请勿公开粘贴。')
    } catch {
      // Never echo SDK error text or signed URL to notifications.
      setActionError('临时分享失败，请检查签名权限与存储连接。')
    } finally {
      setBusyPath(null)
    }
  }

  async function downloadEntry(entry: StorageEntryView) {
    if (!storageId || entry.isDir) return
    const destination = await chooseDownloadPath(entry.name)
    if (!destination) return
    setBusyPath(entry.path)
    setActionError(null)
    try {
      await downloadStorageEntry(storageId, entry.path, destination)
    } catch (error) {
      setActionError(privateS3 ? '私有文件下载失败，请检查存储连接或目标路径。' : `下载失败：${String(error)}`)
    } finally {
      setBusyPath(null)
    }
  }

  async function deleteEntry(entry: StorageEntryView) {
    if (!storageId || entry.isDir) return
    if (!(await confirmAction({ title: '永久删除远端文件', detail: `确定从云端永久删除 “${entry.name}” 吗？\n\n如果它属于 Publisher 资源，本地 Deployment 状态也会同步为已删除。`, confirmLabel: '永久删除' }))) return
    setBusyPath(entry.path)
    setActionError(null)
    try {
      await deleteStorageEntry(storageId, entry.path)
      if (preview?.entry.path === entry.path) closePreview()
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['assets', 'publish-recent'] }),
      ])
    } catch (error) {
      setActionError(privateS3 ? '私有文件删除失败，请检查存储权限。' : `删除失败：${String(error)}`)
    } finally {
      setBusyPath(null)
    }
  }

  function toggleSelected(entry: StorageEntryView) {
    if (entry.isDir) return
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }

  function selectVisibleFiles() {
    // Batch operations are irreversible on the remote, so "全选" only ever covers entries that
    // are actually rendered; hidden items must be revealed before they can be selected.
    setSelectedPaths(new Set(visibleEntries.filter((entry) => !entry.isDir).map((entry) => entry.path)))
  }

  async function refreshAfterRemoteMutation() {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
      queryClient.invalidateQueries({ queryKey: ['assets', 'publish-recent'] }),
    ])
  }

  async function submitPathDialog() {
    if (!storageId || !pathDialog) return
    const value = pathDialog.value.trim()
    if (!value) return
    setOperationBusy(true)
    setActionError(null)
    try {
      if (pathDialog.mode === 'create') {
        await createStorageDirectory(storageId, joinRemotePath(path, value))
      } else if (pathDialog.mode === 'batch_move') {
        const taskId = await queueBatchMoveStorageEntries(storageId, Array.from(selectedPaths), value)
        setSelectedPaths(new Set())
        notifySuccess(`批量移动已进入任务中心：${taskId.slice(0, 8)}…`)
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      } else if (pathDialog.mode === 'batch_rename') {
        const taskId = await queueBatchRenameStorageEntries(storageId, Array.from(selectedPaths), value)
        setSelectedPaths(new Set())
        notifySuccess(`批量重命名已进入任务中心：${taskId.slice(0, 8)}…`)
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      } else if (pathDialog.entry) {
        const entry = pathDialog.entry
        const destination = pathDialog.mode === 'rename'
          ? joinRemotePath(parentPath(entry.path), value)
          : joinRemotePath(value, entry.name)
        await moveStorageEntry(storageId, entry.path, destination)
        setSelectedPaths((current) => {
          const next = new Set(current)
          next.delete(entry.path)
          return next
        })
        if (preview?.entry.path === entry.path) closePreview()
      }
      setPathDialog(null)
      await refreshAfterRemoteMutation()
    } catch (error) {
      const action = pathDialog.mode === 'create' ? '新建目录' : pathDialog.mode === 'rename' ? '重命名' : pathDialog.mode === 'batch_rename' ? '批量重命名' : pathDialog.mode === 'batch_move' ? '批量移动' : '移动'
      setActionError(`${action}失败：${String(error)}`)
    } finally {
      setOperationBusy(false)
    }
  }

  async function batchDeleteSelected() {
    if (!storageId || !selectedPaths.size) return
    const paths = Array.from(selectedPaths)
    if (!(await confirmAction({ title: '批量永久删除', detail: `确定永久删除选中的 ${paths.length} 个远端文件吗？\n\n对应的 Publisher Deployment 状态会同步更新。`, confirmLabel: `永久删除 ${paths.length} 个文件` }))) return
    setOperationBusy(true)
    setActionError(null)
    try {
      const taskId = await queueBatchDeleteStorageEntries(storageId, paths)
      setSelectedPaths(new Set())
      if (preview && paths.includes(preview.entry.path)) closePreview()
      notifySuccess(`批量删除已进入任务中心：${taskId.slice(0, 8)}…`)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setActionError(`批量删除失败：${String(error)}`)
    } finally {
      setOperationBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1320px] px-10 py-9">
      <PageHeader
        title="图库"
        description="直接管理云端真实文件，不依赖本地上传历史。支持目录、预览、下载、单个/批量重命名、移动与删除。"
        action={
          <div className="flex items-center gap-2">
            <select
              value={storageId}
              onChange={(event) => { setStorageId(event.target.value); setPath(''); setSearch('') }}
              className="h-10 min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none"
              disabled={!storages.length}
            >
              {!storages.length && <option value="">暂无存储</option>}
              {storages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.providerKey.toUpperCase()}</option>)}
            </select>
            <button disabled={!storageId} onClick={() => void refetch()} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium disabled:opacity-30">
              {isFetching ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}刷新
            </button>
          </div>
        }
      />

      {!loadingStorages && !storages.length ? (
        <div className="mt-8 rounded-[26px] border border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><ImageIcon size={20} /></div>
          <div className="mt-4 text-sm font-semibold">还没有可浏览的云端</div>
          <p className="mt-1 text-xs text-slate-400">先到“云端”连接 GitHub、R2、Gitee、OSS、COS 或 WebDAV。</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,.03)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
            <button disabled={!path} onClick={() => setPath(parentPath(path))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-25" title="返回上一级"><ChevronLeft size={16} /></button>
            <button onClick={() => setPath('')} className="rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">根目录</button>
            <div className="min-w-[160px] flex-1 truncate rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">/{path}</div>
            <div className="flex h-9 min-w-[230px] items-center gap-2 rounded-xl border border-slate-200 px-3">
              <Search size={14} className="text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索远端文件…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
            </div>
            <button disabled={!storageId || operationBusy || storage?.category === 'repository'} onClick={() => setPathDialog({ mode: 'create', value: '' })} title={storage?.category === 'repository' ? 'GitHub/Gitee 不存在真正的空目录；上传文件时会自动出现目录' : '新建远端目录'} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-30"><Folder size={13} className="mr-1 inline" />新建目录</button>
            {privateS3 && <label className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">
              <Link2 size={13} />限时分享
              <select aria-label="图库限时链接有效期" value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value) as 600 | 3600 | 86400)} className="bg-transparent outline-none">
                <option value={600}>10 分钟</option>
                <option value={3600}>1 小时</option>
                <option value={86400}>24 小时</option>
              </select>
            </label>}
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button onClick={() => setView('grid')} className={`rounded-md p-1.5 ${view === 'grid' ? 'bg-white shadow-sm' : 'text-slate-400'}`} title="网格"><Grid2X2 size={14} /></button>
              <button onClick={() => setView('list')} className={`rounded-md p-1.5 ${view === 'list' ? 'bg-white shadow-sm' : 'text-slate-400'}`} title="列表"><List size={14} /></button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            <span>{storage ? `${storage.name} · ${storage.detail}` : '未选择存储'} · {filtered.length} 项 · {imageCount} 张图片</span>
            <div className="flex items-center gap-2">
              <button disabled={!visibleEntries.some((entry) => !entry.isDir)} onClick={selectVisibleFiles} className="rounded-lg px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30">全选本页文件</button>
              {selectedPaths.size > 0 && <>
                <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">已选 {selectedPaths.size}</span>
                <button onClick={() => setSelectedPaths(new Set())} className="rounded-lg px-2 py-1 font-medium text-slate-500 hover:bg-slate-100">清空</button>
                <button disabled={operationBusy} onClick={() => setPathDialog({ mode: 'batch_move', value: path })} className="rounded-lg bg-slate-50 px-2 py-1 font-medium text-slate-600 disabled:opacity-40">批量移动</button>
                <button disabled={operationBusy} onClick={() => setPathDialog({ mode: 'batch_rename', value: '{stem}-{index}{ext}' })} className="rounded-lg bg-indigo-50 px-2 py-1 font-medium text-indigo-700 disabled:opacity-40">批量改名</button>
                <button disabled={operationBusy} onClick={() => void batchDeleteSelected()} className="rounded-lg bg-red-50 px-2 py-1 font-medium text-red-600 disabled:opacity-40">批量删除</button>
              </>}
            </div>
          </div>

          <div className="min-h-[520px] p-4">
            {isLoading && <div className="grid min-h-[480px] place-items-center text-slate-400"><LoaderCircle size={22} className="animate-spin" /></div>}
            {error && <div className="rounded-2xl bg-red-50 p-4 text-xs leading-6 text-red-600">读取远端失败：{String(error)}</div>}
            {actionError && <div role="alert" className="mb-3 rounded-2xl bg-red-50 p-4 text-xs leading-6 text-red-600">{actionError}</div>}
            {previewError && <div role="alert" className="mb-3 rounded-2xl bg-amber-50 p-4 text-xs leading-6 text-amber-700">{previewError}</div>}
            {!isLoading && !error && !filtered.length && <div className="grid min-h-[480px] place-items-center text-sm text-slate-400">当前目录没有匹配文件</div>}

            {!isLoading && !error && view === 'grid' && visibleEntries.length > 0 && (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
      {visibleEntries.map((entry) => (
        <GalleryMediaCard
          key={entry.path}
          entry={privateS3 ? { ...entry, publicUrl: null } : entry}
          selected={selectedPaths.has(entry.path)}
          copied={copied === entry.path}
          busy={busyPath === entry.path}
          operationBusy={operationBusy}
          previewable={canPreviewCloudImage(entry, storage)}
          previewing={previewingPath === entry.path}
          onShare={privateS3 ? () => void shareEntry(entry) : undefined}
          onSelect={() => toggleSelected(entry)}
          onOpen={() => {
            if (entry.isDir) setPath(entry.path)
            else void openPreview(entry, storage)
          }}
          onCopy={() => void copyUrl(entry)}
          onOpenExternal={() => entry.publicUrl && openExternalUrlOrReport(entry.publicUrl)}
          onRename={() => setPathDialog({ mode: 'rename', entry, value: entry.name })}
          onMove={() => setPathDialog({ mode: 'move', entry, value: parentPath(entry.path) })}
          onDownload={() => void downloadEntry(entry)}
          onDelete={() => void deleteEntry(entry)}
        />
      ))}
    </div>
  )}

  {!isLoading && !error && view === 'list' && visibleEntries.map((entry) => (
              <div key={entry.path} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-500">
                  {entry.isDir ? <Folder size={17} /> : !privateS3 && isImage(entry) && entry.publicUrl ? <img src={entry.publicUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <File size={17} />}
                </div>
                <button disabled={!entry.isDir && !canPreviewCloudImage(entry, storage)} onClick={() => entry.isDir ? setPath(entry.path) : void openPreview(entry, storage)} className="min-w-0 flex-1 text-left disabled:cursor-default">
                  {previewingPath === entry.path && <span className="text-[10px] text-amber-700">读取私有预览中…</span>}
                  <div className="truncate text-sm font-medium">{entry.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">{entry.isDir ? '目录' : `${sizeLabel(entry.sizeBytes)} · ${entry.path}`}</div>
                </button>
                {!entry.isDir && <>
                  {!privateS3 && entry.publicUrl && <button onClick={() => void copyUrl(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" title="复制公开链接"><Copy size={14} /></button>}
                  {!privateS3 && entry.publicUrl && <button onClick={() => openExternalUrlOrReport(entry.publicUrl || '')} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" title="浏览器打开"><ExternalLink size={14} /></button>}
                  {privateS3 && <button disabled={busyPath !== null} onClick={() => void shareEntry(entry)} className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50 disabled:opacity-30" title="复制限时分享链接"><Link2 size={14} /></button>}
                  <button disabled={operationBusy} onClick={() => setPathDialog({ mode: 'rename', entry, value: entry.name })} className="rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-white hover:text-slate-700" title="重命名">改名</button>
                  <button disabled={operationBusy} onClick={() => setPathDialog({ mode: 'move', entry, value: parentPath(entry.path) })} className="rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-white hover:text-slate-700" title="移动">移动</button>
                  <button disabled={busyPath === entry.path} onClick={() => void downloadEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30" title="下载"><Download size={14} /></button>
                  <button disabled={busyPath === entry.path} onClick={() => void deleteEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title="永久删除"><Trash2 size={14} /></button>
                </>}
              </div>
            ))}
            {hiddenCount > 0 && (revealCapped ? (
              <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs leading-5 text-amber-700">
                本页最多渲染约 {GALLERY_RENDER_CAP} 项，还有 {hiddenCount} 项未显示。继续追加会让滚动变慢，请进入更深的目录或用搜索缩小范围。
              </div>
            ) : (
              <button onClick={() => setVisibleCount((current) => current + GALLERY_PAGE_SIZE)} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                继续显示 {Math.min(GALLERY_PAGE_SIZE, hiddenCount)} 项（还有 {hiddenCount} 项未渲染）
              </button>
            ))}
          </div>
        </section>
      )}

      {pathDialog && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm" onMouseDown={() => !operationBusy && setPathDialog(null)}>
          <div className="w-full max-w-md rounded-[24px] border border-white bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-base font-semibold">{pathDialog.mode === 'create' ? '新建云端目录' : pathDialog.mode === 'rename' ? '重命名远端文件' : pathDialog.mode === 'batch_rename' ? `批量重命名 ${selectedPaths.size} 个文件` : pathDialog.mode === 'batch_move' ? `批量移动 ${selectedPaths.size} 个文件` : '移动远端文件'}</div>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {pathDialog.mode === 'create' ? `当前目录：/${path}` : pathDialog.mode === 'rename' ? `原路径：/${pathDialog.entry?.path || ''}` : pathDialog.mode === 'batch_rename' ? '模板支持 {name}、{stem}、{ext}、{index}；不会覆盖已存在的远端文件。' : '填写目标目录路径；文件名保持不变，目标冲突会逐项报告。'}
            </p>
            <label className="mt-4 block text-xs font-medium text-slate-600">{pathDialog.mode === 'create' ? '目录名称' : pathDialog.mode === 'rename' ? '新文件名' : pathDialog.mode === 'batch_rename' ? '文件名模板' : '目标目录'}</label>
            <input autoFocus value={pathDialog.value} onChange={(event) => setPathDialog((current) => current ? { ...current, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === 'Enter') void submitPathDialog() }} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={operationBusy} onClick={() => setPathDialog(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-medium disabled:opacity-40">取消</button>
              <button disabled={operationBusy || !pathDialog.value.trim()} onClick={() => void submitPathDialog()} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-40">{operationBusy ? '处理中…' : '确认'}</button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/75 p-8" onMouseDown={closePreview}>
          <div role="dialog" aria-modal="true" aria-label={`图片预览：${preview.entry.name}`} className="relative max-h-full max-w-full" onMouseDown={(event) => event.stopPropagation()}>
            <button onClick={closePreview} className="absolute -right-3 -top-3 z-10 grid size-9 place-items-center rounded-full bg-white text-slate-500 shadow-lg" title="关闭预览"><X size={16} /></button>
            <img src={preview.src} alt={preview.entry.name} decoding="async" className="max-h-[80vh] max-w-[88vw] rounded-2xl bg-white object-contain shadow-2xl" />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <div className="max-w-[46vw] truncate rounded-xl bg-white/95 px-3 py-2 text-xs font-medium">{preview.entry.name}</div>
              {preview.privateMode && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">凭据预览 · 无公开链接</div>}
              {!preview.privateMode && <button onClick={() => void copyUrl(preview.entry)} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><Copy size={13} className="mr-1 inline" />复制链接</button>}
              {!preview.privateMode && <button onClick={() => preview.entry.publicUrl && openExternalUrlOrReport(preview.entry.publicUrl)} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><ExternalLink size={13} className="mr-1 inline" />浏览器打开</button>}
              {preview.privateMode && <button onClick={() => void shareEntry(preview.entry)} className="rounded-xl bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700"><Link2 size={13} className="mr-1 inline" />临时分享</button>}
              <button onClick={() => void downloadEntry(preview.entry)} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><Download size={13} className="mr-1 inline" />保存原图</button>
              <button onClick={() => void deleteEntry(preview.entry)} className="rounded-xl bg-red-50 px-4 py-2 text-xs font-medium text-red-600"><Trash2 size={13} className="mr-1 inline" />删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

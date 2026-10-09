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
  LoaderCircle,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { browseStorage, chooseDownloadPath, copyText, createTemporaryShareLink, deleteStorageEntry, downloadStorageEntry, openExternalUrlOrReport } from '../lib/desktop'
import { notifySuccess } from '../store/useToastStore'
import { confirmAction } from '../store/useConfirmStore'
import type { StorageEntryView, StorageView } from '../types'

function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function sizeLabel(size?: number | null) {
  if (size == null) return ''
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function isImage(entry: StorageEntryView) {
  if (entry.isDir) return false
  const source = `${entry.name} ${entry.publicUrl || ''}`.toLowerCase().split('?')[0]
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].some((extension) => source.endsWith(extension) || source.includes(`${extension} `))
}

export function StorageBrowserDialog({ storage, onClose }: { storage: StorageView; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [preview, setPreview] = useState<StorageEntryView | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [shareExpiry, setShareExpiry] = useState<600 | 3600 | 86400>(3600)
  const supportsTemporaryShare = storage.providerKey === 'r2' || storage.providerKey === 's3'
  const [actionError, setActionError] = useState<string | null>(null)
  const queryKey = useMemo(() => ['storage-browser', storage.id, path], [storage.id, path])
  const { data: entries = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => browseStorage(storage.id, path),
  })
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) => entry.name.toLowerCase().includes(keyword) || entry.path.toLowerCase().includes(keyword))
  }, [entries, search])
  const imageCount = filtered.filter(isImage).length

  async function downloadEntry(entry: StorageEntryView) {
    if (entry.isDir) return
    const destination = await chooseDownloadPath(entry.name)
    if (!destination) return
    setBusyPath(entry.path)
    setActionError(null)
    try {
      await downloadStorageEntry(storage.id, entry.path, destination)
    } catch (error) {
      setActionError(`下载失败：${String(error)}`)
    } finally {
      setBusyPath(null)
    }
  }

  async function shareEntry(entry: StorageEntryView) {
    if (entry.isDir || !supportsTemporaryShare) return
    setBusyPath(entry.path)
    setActionError(null)
    try {
      const signedUrl = await createTemporaryShareLink(storage.id, entry.path, shareExpiry)
      try {
        await copyText(signedUrl)
      } catch {
        // Do not interpolate the signed URL into an error message or any log/toast.
        setActionError('链接已生成，但写入剪贴板失败；请重新操作。')
        return
      }
      const label = shareExpiry === 600 ? '10 分钟' : shareExpiry === 3600 ? '1 小时' : '24 小时'
      notifySuccess(`限时 ${label} 的只读链接已复制。持有链接的任何人均可访问。`)
    } catch (error) {
      setActionError(`临时分享失败：${String(error)}`)
    } finally {
      setBusyPath(null)
    }
  }

  async function deleteEntry(entry: StorageEntryView) {
    if (entry.isDir) return
    if (!(await confirmAction({ title: '永久删除远端文件', detail: `确定从云端永久删除 “${entry.name}” 吗？`, confirmLabel: '永久删除' }))) return
    setBusyPath(entry.path)
    setActionError(null)
    try {
      await deleteStorageEntry(storage.id, entry.path)
      if (preview?.path === entry.path) setPreview(null)
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['assets', 'publish-recent'] }),
      ])
    } catch (error) {
      setActionError(`删除失败：${String(error)}`)
    } finally {
      setBusyPath(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/25 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section onMouseDown={(event) => event.stopPropagation()} className="flex h-[min(760px,92vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-[28px] border border-white bg-white shadow-[0_30px_100px_rgba(15,23,42,.22)]">
        <div className="flex items-start gap-3 border-b border-slate-100 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{storage.name}</h2>
            <p className="mt-1 text-xs text-slate-400">远端资源浏览器 · {storage.detail}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <button disabled={!path} onClick={() => setPath(parentPath(path))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ChevronLeft size={16} /></button>
          <button onClick={() => setPath('')} className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">根目录</button>
          <div className="min-w-[160px] flex-1 truncate rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">/{path}</div>
          <div className="flex h-9 min-w-[210px] items-center gap-2 rounded-xl border border-slate-200 px-3">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件名…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          </div>
          {supportsTemporaryShare && <label className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-xs text-slate-600" title="私有对象不必改成公开；链接过期后失效，不能逐链接撤销">
            <Link2 size={13} aria-hidden="true" />
            <span>临时分享</span>
            <select aria-label="临时链接有效期" value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value) as 600 | 3600 | 86400)} className="bg-transparent text-xs outline-none">
              <option value={600}>10 分钟</option>
              <option value={3600}>1 小时</option>
              <option value={86400}>24 小时</option>
            </select>
          </label>}
          <button onClick={() => void refetch()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="刷新">{isFetching ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}</button>
          <div className="flex rounded-lg bg-slate-100 p-1">
            <button onClick={() => setView('grid')} className={`rounded-md p-1.5 ${view === 'grid' ? 'bg-white shadow-sm' : 'text-slate-400'}`} title="网格"><Grid2X2 size={14} /></button>
            <button onClick={() => setView('list')} className={`rounded-md p-1.5 ${view === 'list' ? 'bg-white shadow-sm' : 'text-slate-400'}`} title="列表"><List size={14} /></button>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2 text-[11px] text-slate-400">
          <span>{filtered.length} 项 · {imageCount} 张可预览图片</span>
          <span>{supportsTemporaryShare ? '临时链接仅限 GET；持有者均可访问，过期前无法单独撤销' : '点击目录进入 · 点击图片预览'}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isLoading && <div className="grid h-full place-items-center text-slate-400"><LoaderCircle size={20} className="animate-spin" /></div>}
          {error && <div className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">{String(error)}</div>}
          {actionError && <div className="mb-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">{actionError}</div>}
          {!isLoading && !error && !filtered.length && <div className="grid h-full place-items-center text-sm text-slate-400">这个目录没有匹配的文件</div>}

          {!isLoading && !error && view === 'grid' && filtered.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {filtered.map((entry) => {
                const image = isImage(entry)
                return <article key={entry.path} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md">
                  <button
                    onClick={() => entry.isDir ? setPath(entry.path) : image && entry.publicUrl ? setPreview(entry) : undefined}
                    className="block w-full text-left"
                  >
                    <div className="grid aspect-[4/3] place-items-center overflow-hidden bg-slate-50">
                      {entry.isDir ? <Folder size={34} className="text-slate-300" /> : image && entry.publicUrl ? <img src={entry.publicUrl} alt={entry.name} loading="lazy" decoding="async" className="h-full w-full object-contain" /> : image ? <ImageIcon size={32} className="text-slate-300" /> : <File size={30} className="text-slate-300" />}
                    </div>
                    <div className="p-3"><div className="truncate text-xs font-medium" title={entry.name}>{entry.name}</div><div className="mt-1 text-[10px] text-slate-400">{entry.isDir ? '目录' : sizeLabel(entry.sizeBytes) || '远端文件'}</div></div>
                  </button>
                  {!entry.isDir && <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 p-2 opacity-80 group-hover:opacity-100">
                    {entry.publicUrl && <button onClick={() => void copyText(entry.publicUrl || '')} className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-slate-500 hover:bg-slate-50" title="复制公开链接"><Copy size={12} />复制</button>}
                    {entry.publicUrl && <button onClick={() => openExternalUrlOrReport(entry.publicUrl || '')} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50" title="浏览器打开"><ExternalLink size={12} /></button>}
                    {supportsTemporaryShare && <button disabled={busyPath === entry.path} onClick={() => void shareEntry(entry)} className="flex items-center gap-1 rounded-lg p-1.5 text-[10px] text-indigo-600 hover:bg-indigo-50 disabled:opacity-30" title="为当前对象生成限时 GET 签名链接并复制"><Link2 size={12} />限时链接</button>}
                    <button disabled={busyPath === entry.path} onClick={() => void downloadEntry(entry)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-30" title="下载"><Download size={12} /></button>
                    <button disabled={busyPath === entry.path} onClick={() => void deleteEntry(entry)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title="永久删除"><Trash2 size={12} /></button>
                  </div>}
                </article>
              })}
            </div>
          )}

          {!isLoading && !error && view === 'list' && filtered.map((entry) => (
            <div key={entry.path} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
              <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-500">
                {entry.isDir ? <Folder size={16} /> : isImage(entry) && entry.publicUrl ? <img src={entry.publicUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <File size={16} />}
              </div>
              <button disabled={!entry.isDir && !(isImage(entry) && entry.publicUrl)} onClick={() => entry.isDir ? setPath(entry.path) : setPreview(entry)} className="min-w-0 flex-1 text-left disabled:cursor-default">
                <div className="truncate text-sm font-medium">{entry.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-400">{entry.isDir ? '目录' : `${sizeLabel(entry.sizeBytes)} · ${entry.path}`}</div>
              </button>
              {!entry.isDir && <>
                {entry.publicUrl && <button onClick={() => void copyText(entry.publicUrl || '')} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" title="复制公开链接"><Copy size={14} /></button>}
                {entry.publicUrl && <button onClick={() => openExternalUrlOrReport(entry.publicUrl || '')} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" title="浏览器打开"><ExternalLink size={14} /></button>}
                {supportsTemporaryShare && <button disabled={busyPath === entry.path} onClick={() => void shareEntry(entry)} className="flex items-center gap-1 rounded-lg p-2 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-30" title="生成限时 GET 签名链接并复制"><Link2 size={14} />临时分享</button>}
                <button disabled={busyPath === entry.path} onClick={() => void downloadEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30" title="下载"><Download size={14} /></button>
                <button disabled={busyPath === entry.path} onClick={() => void deleteEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title="永久删除"><Trash2 size={14} /></button>
              </>}
            </div>
          ))}
        </div>
      </section>

      {preview?.publicUrl && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/75 p-8" onMouseDown={(event) => { event.stopPropagation(); setPreview(null) }}>
        <div className="relative max-h-full max-w-full" onMouseDown={(event) => event.stopPropagation()}>
          <img src={preview.publicUrl} alt={preview.name} decoding="async" className="max-h-[82vh] max-w-[88vw] rounded-2xl bg-white object-contain shadow-2xl" />
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={() => void copyText(preview.publicUrl || '')} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><Copy size={13} className="mr-1 inline" />复制链接</button>
            <button onClick={() => openExternalUrlOrReport(preview.publicUrl || '')} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><ExternalLink size={13} className="mr-1 inline" />浏览器打开</button>
            <button onClick={() => void downloadEntry(preview)} className="rounded-xl bg-white px-4 py-2 text-xs font-medium"><Download size={13} className="mr-1 inline" />下载</button>
            <button onClick={() => void deleteEntry(preview)} className="rounded-xl bg-red-50 px-4 py-2 text-xs font-medium text-red-600"><Trash2 size={13} className="mr-1 inline" />删除</button>
            <button onClick={() => setPreview(null)} className="rounded-xl bg-white px-4 py-2 text-xs font-medium">关闭</button>
          </div>
        </div>
      </div>}
    </div>
  )
}

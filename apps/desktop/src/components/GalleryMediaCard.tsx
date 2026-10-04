import { useState, type ReactNode } from 'react'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  Image as ImageIcon,
  MoreHorizontal,
  Move,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { StorageEntryView } from '../types'

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

export function GalleryMediaCard({
  entry,
  selected,
  copied,
  busy,
  operationBusy,
  onSelect,
  onOpen,
  onCopy,
  onOpenExternal,
  onRename,
  onMove,
  onDownload,
  onDelete,
}: {
  entry: StorageEntryView
  selected: boolean
  copied: boolean
  busy: boolean
  operationBusy: boolean
  onSelect: () => void
  onOpen: () => void
  onCopy: () => void
  onOpenExternal: () => void
  onRename: () => void
  onMove: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const image = isImage(entry)
  const [showMore, setShowMore] = useState(false)

  if (entry.isDir) {
    return (
      <button
        onClick={onOpen}
        className="theme-surface group overflow-hidden rounded-[24px] border text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_44px_rgba(15,23,42,.10)]"
      >
        <div className="grid aspect-[4/3] place-items-center bg-[var(--surface-soft)]">
          <div className="grid size-16 place-items-center rounded-[22px] bg-[var(--accent-soft)] text-[var(--accent)] transition group-hover:scale-105">
            <Folder size={30} strokeWidth={1.6} />
          </div>
        </div>
        <div className="p-4">
          <div className="truncate text-sm font-semibold" title={entry.name}>{entry.name}</div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">云端目录 · 点击进入</div>
        </div>
      </button>
    )
  }

  return (
    <article className={`theme-surface group relative overflow-visible rounded-[24px] border transition duration-200 hover:-translate-y-1 hover:shadow-[0_18px_48px_rgba(15,23,42,.13)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)] ${selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent' : ''}`}>
      <div className="relative overflow-hidden rounded-t-[23px]">
        <label
          className={`absolute left-3 top-3 z-30 grid size-8 place-items-center rounded-xl border border-white/70 bg-white/88 shadow-sm backdrop-blur-md transition ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          onClick={(event) => event.stopPropagation()}
          title="选择这个远端文件"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`选择 ${entry.name}`}
            className="size-4 accent-[var(--accent)]"
          />
        </label>

        <button onClick={onOpen} className="relative block w-full overflow-hidden text-left">
          <div className="relative aspect-[4/3] overflow-hidden bg-[var(--surface-soft)]">
            {image && entry.publicUrl ? (
              <>
                <img
                  src={entry.publicUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-xl"
                />
                <img
                  src={entry.publicUrl}
                  alt={entry.name}
                  loading="lazy"
                  decoding="async"
                  className="relative z-10 h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]"
                />
              </>
            ) : image ? (
              <div className="grid h-full place-items-center text-[var(--text-muted)]"><ImageIcon size={36} strokeWidth={1.5} /></div>
            ) : (
              <div className="grid h-full place-items-center text-[var(--text-muted)]"><File size={34} strokeWidth={1.5} /></div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-slate-950/70 via-slate-950/20 to-transparent opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 translate-y-2 text-[10px] font-medium text-white/90 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
              点击图片预览
            </div>
          </div>
        </button>

        <div className={`absolute right-3 top-3 z-40 flex items-center gap-1 rounded-2xl border border-white/60 bg-white/88 p-1 shadow-lg backdrop-blur-md transition ${showMore ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          {entry.publicUrl && (
            <OverlayButton title="复制公网 URL" onClick={onCopy}>
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            </OverlayButton>
          )}
          {entry.publicUrl && <OverlayButton title="浏览器打开" onClick={onOpenExternal}><ExternalLink size={14} /></OverlayButton>}
          <OverlayButton title="下载到本地" onClick={onDownload} disabled={busy}><Download size={14} /></OverlayButton>
          <OverlayButton title="更多操作" onClick={() => setShowMore((value) => !value)} active={showMore}><MoreHorizontal size={15} /></OverlayButton>
        </div>

        {showMore && (
          <div className="absolute right-3 top-14 z-50 w-40 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_18px_55px_rgba(15,23,42,.2)] backdrop-blur-xl">
            <MenuButton label="重命名" icon={<Pencil size={13} />} disabled={operationBusy} onClick={() => { setShowMore(false); onRename() }} />
            <MenuButton label="移动" icon={<Move size={13} />} disabled={operationBusy} onClick={() => { setShowMore(false); onMove() }} />
            <div className="my-1 border-t border-[var(--border)]" />
            <MenuButton danger label="永久删除" icon={<Trash2 size={13} />} disabled={busy} onClick={() => { setShowMore(false); onDelete() }} />
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-b-[23px] p-4">
        <div className="truncate text-sm font-semibold" title={entry.name}>{entry.name}</div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          <span>{sizeLabel(entry.sizeBytes) || '远端文件'}</span>
          <span className="max-w-[58%] truncate" title={entry.path}>{entry.path}</span>
        </div>
        {copied && <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-600"><Check size={11} />公网 URL 已复制</div>}
      </div>
    </article>
  )
}

function OverlayButton({
  title,
  onClick,
  disabled,
  active = false,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`grid size-8 place-items-center rounded-xl text-slate-600 transition hover:bg-white disabled:opacity-30 ${active ? 'bg-white text-slate-950 shadow-sm' : ''}`}
    >
      {children}
    </button>
  )
}

function MenuButton({
  label,
  icon,
  onClick,
  disabled,
  danger = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition disabled:opacity-30 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]'}`}
    >
      {icon}<span>{label}</span>
    </button>
  )
}

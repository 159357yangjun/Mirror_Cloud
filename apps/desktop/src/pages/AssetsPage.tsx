import { Check, Cloud, Copy, Download, Eye, LoaderCircle, RefreshCw, Search, Sparkles, Trash2, Upload, WifiOff, Plug, Images, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ReadFailurePanel } from '../components/ReadFailurePanel'
import { CloudIndexSyncBanner } from '../components/CloudIndexSyncBanner'
import {
  copyText,
  createTemporaryShareLink,
  chooseDownloadPath,
  downloadStorageEntry,
  previewPrivateStorageEntry,
  deleteAsset,
  getOutputPreferences,
  listAssets,
  listStorages,
  listPlugins,
  repairAsset,
  saveOutputPreferences,
} from '../lib/desktop'
import { useAppStore } from '../store/useAppStore'
import { confirmAction } from '../store/useConfirmStore'
import type { AssetView, OutputFormat, OutputPreferences } from '../types'
import { formatPublishedAsset } from '../lib/output'

const sizeLabel = (size: number) =>
  size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`

const outputFormatLabel: Record<OutputFormat, string> = {
  markdown: 'Markdown',
  url: 'URL',
  html: 'HTML',
  bbcode: 'BBCode',
  custom: '自定义格式',
}

// The ladder in the user's words. Level 1 is what "在线" has always silently meant: the provider
// accepted the bytes. Anything above that requires having actually looked again, so the label says
// which claim is on the table instead of letting one green chip cover four different situations.
const CONFIRMATION_LABELS = ['未核对', '已上传', '远端可见', '内容一致'] as const

function confirmationLabel(deployment: AssetView['deployments'][number]): string {
  const level = Math.max(0, Math.min(CONFIRMATION_LABELS.length - 1, deployment.confirmationLevel))
  return CONFIRMATION_LABELS[level]
}
// Turns the stored failure category into an instruction. Keyed off the kind rather than the message
// so the advice stays stable when wording changes, and deliberately quiet when no kind was recorded:
// rows predating that column have no reason to guess from, and inventing one is how a field starts
// lying.
const ERROR_HINTS: Record<string, string> = {
  authentication: ' · 凭证或权限问题：请检查 Token 与授权范围',
  network: ' · 网络未送达：稍后重试即可，无需改配置',
  rate_limited: ' · 被限流：请放慢重试，不要立即重发',
  not_found: ' · 目标不存在：请修正仓库/分支/路径设置',
  conflict: ' · 与其他写入冲突：瞬时问题，可重试',
  rejected: ' · 服务端拒绝：请看下方原始错误信息',
  unsupported: ' · 该存储不支持此操作：换一个存储',
  not_implemented: ' · 本应用尚未实现：欢迎反馈',
}

function errorHint(deployment: AssetView['deployments'][number]): string {
  if (!deployment.errorKind) return deployment.error ? ` · ${deployment.error}` : ''
  const hint = ERROR_HINTS[deployment.errorKind] ?? ERROR_HINTS.rejected
  return `${hint}｜${deployment.error ?? ''}`
}


export function AssetsPage() {
  const openUpload = useAppStore((state) => state.openUpload)
  const setPage = useAppStore((state) => state.setPage)
  const queryClient = useQueryClient()
  const [assetLimit, setAssetLimit] = useState(200)
  const { data: assets = [], error: assetsError, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets', assetLimit],
    queryFn: () => listAssets(assetLimit),
    refetchInterval: 2500,
  })
  const { data: storages = [] } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const { data: plugins = [] } = useQuery({ queryKey: ['plugins'], queryFn: listPlugins })
  const {
    data: preferences = {
      defaultFormat: 'markdown',
      customTemplate: '![{name}]({url})',
      autoCopyAfterPublish: true,
      imageFormat: 'webp',
    } as OutputPreferences,
  } = useQuery({ queryKey: ['output-preferences'], queryFn: getOutputPreferences })
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareExpiry, setShareExpiry] = useState<600 | 3600 | 86400>(600)
  const [preview, setPreview] = useState<{ assetId: string; name: string; url: string } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [privateActionError, setPrivateActionError] = useState<string | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // Preview bytes only exist in a temporary in-memory object URL. Revoke on
  // close, image change or leaving the page; do not persist them or signed URLs.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url)
  }, [preview])

  const listTruncated = assets.length >= assetLimit

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return assets
    return assets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(keyword) ||
        asset.publicUrl.toLowerCase().includes(keyword),
    )
  }, [assets, search])

  const formatMutation = useMutation({
    mutationFn: (defaultFormat: OutputFormat) =>
      saveOutputPreferences({ ...preferences, defaultFormat }),
    onSuccess: (next) => queryClient.setQueryData(['output-preferences'], next),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['assets'] })
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      }, 700)
    },
  })

  const repairMutation = useMutation({
    mutationFn: repairAsset,
    onMutate: (assetId) => setRepairing(assetId),
    onSettled: () => setRepairing(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['assets'] })
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      }, 1000)
    },
  })

  async function copy(asset: AssetView) {
    if (!asset.publicUrl) return
    await copyText(formatPublishedAsset(asset.name, asset.publicUrl, preferences))
    setCopied(asset.id)
    window.setTimeout(
      () => setCopied((current) => (current === asset.id ? null : current)),
      1200,
    )
  }

  function privateR2Target(asset: AssetView) {
    return asset.deployments.find(
      (entry) => entry.ok && entry.providerKey === 'r2' && entry.accessMode === 'private_requested',
    )
  }

  async function openPrivatePreview(asset: AssetView) {
    const target = privateR2Target(asset)
    if (!target || previewing || !asset.mimeType.startsWith('image/')) return
    setPrivateActionError(null)
    setPreviewing(asset.id)
    try {
      const result = await previewPrivateStorageEntry(target.storageId, target.remotePath)
      if (!mounted.current) return
      const bytes = Uint8Array.from(result.bytes)
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      setPreview({ assetId: asset.id, name: asset.name, url })
    } catch {
      if (mounted.current) {
        setPrivateActionError('无法预览此图片，请检查存储连接、格式或文件大小（预览上限为 5 MB）。')
      }
    } finally {
      if (mounted.current) setPreviewing(null)
    }
  }

  async function savePrivateOriginal(asset: AssetView) {
    const target = privateR2Target(asset)
    if (!target || downloading) return
    setPrivateActionError(null)
    setDownloading(asset.id)
    try {
      const path = await chooseDownloadPath(asset.name)
      if (path) await downloadStorageEntry(target.storageId, target.remotePath, path)
    } catch {
      if (mounted.current) setPrivateActionError('保存原图失败，请检查存储连接和目标文件夹。')
    } finally {
      if (mounted.current) setDownloading(null)
    }
  }

  async function sharePrivateAsset(asset: AssetView) {
    const target = asset.deployments.find(
      (entry) => entry.ok && entry.providerKey === 'r2' && entry.accessMode === 'private_requested',
    )
    if (!target || sharing) return
    const requestedExpiry = shareExpiry
    setSharing(asset.id)
    setShareError(null)
    try {
      const signedUrl = await createTemporaryShareLink(target.storageId, target.remotePath, requestedExpiry)
      await copyText(signedUrl)
      setCopied(`share:${asset.id}`)
    } catch {
      // A provider error can contain a signed URL; never mirror it into an untrusted toast.
      setShareError('临时分享失败，请检查存储连接、对象路径和签名权限。')
    } finally {
      setSharing(null)
    }
  }

  async function copyPluginOutput(assetId: string, pluginId: string, text: string) {
    if (!text) return
    await copyText(text)
    const key = `${assetId}:${pluginId}`
    setCopied(key)
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200)
  }

  async function remove(asset: AssetView) {
    const accepted = await confirmAction({
      title: '删除资源',
      detail: `从所有已记录的云端位置删除“${asset.name}”吗？这个操作会真正删除远端文件。`,
      confirmLabel: '删除',
    })
    if (accepted) deleteMutation.mutate(asset.id)
  }

  return (
    <div className="mx-auto max-w-[1380px] px-10 py-9">
      <PageHeader
        title="资源"
        description="这里是镜云维护的发布索引：记录上传结果、公开 URL、多云副本和插件输出；图片本体仍保存在真实云端。"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setPage('gallery')} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
              <Images size={16} />云端图库
            </button>
            <button onClick={() => openUpload('files')} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">
              <Upload size={16} />上传
            </button>
          </div>
        }
      />

      <CloudIndexSyncBanner onOpenGallery={() => setPage('gallery')} />

      <div className="mt-6 flex items-center gap-3">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          <Search size={15} className="text-[var(--text-muted)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder="搜索文件名或 URL…" />
        </div>
        <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          <span className="text-[11px] text-[var(--text-muted)]">复制格式</span>
          <select value={preferences.defaultFormat} onChange={(event) => formatMutation.mutate(event.target.value as OutputFormat)} className="h-full bg-transparent text-xs text-[var(--text-secondary)] outline-none" title="资源卡片的复制按钮会使用这个格式">
            <option value="markdown">Markdown</option>
            <option value="url">URL</option>
            <option value="html">HTML</option>
            <option value="bbcode">BBCode</option>
            <option value="custom">自定义模板</option>
          </select>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--text-secondary)]">
          限时分享
          <select value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value) as 600 | 3600 | 86400)} className="bg-transparent text-xs" aria-label="限时分享有效期">
            <option value={600}>10 分钟</option>
            <option value={3600}>1 小时</option>
            <option value={86400}>24 小时</option>
          </select>
        </label>
      </div>
      {shareError && <p role="alert" className="mt-3 text-xs text-red-600">{shareError}</p>}
      {privateActionError && <p role="alert" className="mt-3 text-xs text-red-600">{privateActionError}</p>}
      {copied?.startsWith('share:') && <p role="status" className="mt-3 text-xs text-amber-700">临时只读链接已复制。持有链接的人在有效期内可能访问该对象；请勿公开粘贴。</p>}

      <section className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-5">
        {assetsError && !assets.length && <ReadFailurePanel className="col-span-full rounded-[26px] border border-dashed border-red-200 bg-red-50 p-10 text-center text-sm text-red-600" subject="资源" error={assetsError} />}
        {assetsLoading && <div className="col-span-full grid min-h-[240px] place-items-center text-slate-300"><LoaderCircle size={22} className="animate-spin" /></div>}
        {!assetsError && !assetsLoading && !filtered.length && (
          <div className="col-span-full rounded-[26px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-10">
            {search ? (
              <div className="text-center">
                <div className="text-sm font-medium">没有匹配的资源</div>
                {listTruncated && <div className="mt-1 text-xs text-[var(--text-muted)]">当前只在已加载的 {assets.length} 条里搜索，更早的资源还没有取回本地。</div>}
                {listTruncated && assetLimit < 10_000 && <button onClick={() => setAssetLimit((current) => Math.min(current + 200, 10_000))} className="mt-3 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-medium">加载更多后再搜一次</button>}
              </div>
            ) : (
              <div>
                <div className="text-center"><div className="mx-auto grid size-11 place-items-center rounded-2xl bg-slate-950 text-white"><Sparkles size={17} /></div><div className="mt-4 text-sm font-semibold">3 步完成第一次公网发布</div><div className="mt-1 text-xs text-[var(--text-muted)]">不用先理解 Endpoint、Workflow 或多云策略；连接云端、按需开启插件，然后上传。</div></div>
                <div className="mx-auto mt-7 grid max-w-3xl grid-cols-3 gap-3 max-md:grid-cols-1">
                  <button onClick={() => setPage('storages')} className={`rounded-2xl border p-4 text-left ${storages.length ? 'border-emerald-100 bg-emerald-50/50' : 'border-[var(--border)]'}`}><Cloud size={16} className={storages.length ? 'text-emerald-600' : 'text-[var(--text-muted)]'} /><div className="mt-3 text-xs font-medium">1. 连接云端</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{storages.length ? `已连接 ${storages.length} 个` : 'R2 / GitHub / Gitee'}</div></button>
                  <button onClick={() => setPage('plugins')} className={`rounded-2xl border p-4 text-left ${plugins.some((plugin) => plugin.enabled) ? 'border-emerald-100 bg-emerald-50/50' : 'border-[var(--border)]'}`}><Plug size={16} className={plugins.some((plugin) => plugin.enabled) ? 'text-emerald-600' : 'text-[var(--text-muted)]'} /><div className="mt-3 text-xs font-medium">2. 开启插件</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{plugins.length ? `${plugins.filter((plugin) => plugin.enabled).length}/${plugins.length} 个已开启` : '可选，不安装也能上传'}</div></button>
                  <button disabled={!storages.length} onClick={() => openUpload('files')} className="rounded-2xl border border-[var(--border)] p-4 text-left disabled:opacity-40"><Upload size={16} className="text-[var(--text-muted)]" /><div className="mt-3 text-xs font-medium">3. 上传图片</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">拖入图片即可发布</div></button>
                </div>
                {storages.length > 0 && <div className="mx-auto mt-4 flex max-w-3xl items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3"><div><div className="text-xs font-medium text-indigo-900">主要用 Typora？</div><div className="mt-0.5 text-[11px] text-indigo-700">Typora 通过“自定义命令”调用当前上传链，不要求使用 PicGo。</div></div><button onClick={() => setPage('settings')} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white">打开 Typora 配置向导 →</button></div>}
              </div>
            )}
          </div>
        )}

        {filtered.map((asset) => (
          <article key={asset.id} className="group overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(15,23,42,.045)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_55px_rgba(15,23,42,.09)]">
            <div className="relative aspect-[16/10] overflow-hidden bg-[var(--surface-soft)]">
              {asset.publicUrl ? (
                <img src={asset.publicUrl} alt={asset.name} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]" loading="lazy" decoding="async" />
              ) : (
                <div className="grid h-full place-items-center px-3 text-center text-xs text-[var(--text-muted)]">{asset.deployments.some((deployment) => deployment.ok && deployment.accessMode === 'private_requested') ? '已上传至私有模式目标 · 无公开 URL' : '没有公开 URL · 访问状态未知'}</div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/35 to-transparent opacity-0 transition group-hover:opacity-100" />
              <button disabled={deleteMutation.isPending} onClick={() => void remove(asset)} className="absolute right-3 top-3 rounded-xl bg-white/92 p-2 text-slate-500 opacity-0 shadow-sm backdrop-blur transition hover:text-red-500 group-hover:opacity-100" title="永久删除这个资源已记录的远端副本">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={asset.name}>{asset.name}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{sizeLabel(asset.sizeBytes)} · {asset.mimeType}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] ${asset.status === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {asset.status === 'online' ? <Check size={11} /> : <WifiOff size={11} />} {asset.status === 'online' ? (asset.publicUrl ? '已上传 · 有公开链接' : '已上传 · 无公开链接') : asset.status === 'partial' ? '部分异常' : '上传失败'}
                </span>
              </div>

              {asset.deployments.some((deployment) => deployment.accessMode === 'private_requested') && <p className="mt-2 text-[11px] leading-5 text-amber-700">已请求私有存储，但镜云尚未验证 Bucket、域名或 CDN 是否允许匿名访问。</p>}
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {asset.deployments.map((deployment) => (
                  <span
                    key={`${deployment.storage}-${deployment.role}`}
                    title={`${deployment.providerKey} · ${deployment.role}${errorHint(deployment)}`}
                    className={`rounded-lg border px-2 py-1 text-[10px] ${deployment.ok ? 'border-[var(--border)] text-[var(--text-muted)]' : 'border-red-100 bg-red-50 text-red-500'}`}
                  >
                    {deployment.storage} · {deployment.role} · {confirmationLabel(deployment)}{deployment.accessMode === 'private_requested' ? ' · 私有意图' : ''}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-3">
                {asset.status === 'partial' && (
                  <button
                    disabled={repairing === asset.id}
                    onClick={() => repairMutation.mutate(asset.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    title="从健康云端副本重新写入失败的云端"
                  >
                    <RefreshCw size={12} className={repairing === asset.id ? 'animate-spin' : ''} />修复副本
                  </button>
                )}
                {privateR2Target(asset) && (
                  <>
                  <button disabled={previewing !== null || asset.sizeBytes > 5 * 1024 * 1024} onClick={() => void openPrivatePreview(asset)} className="inline-flex items-center gap-1 rounded-xl bg-[var(--surface-soft)] px-2.5 py-2 text-[11px] font-medium text-[var(--text-secondary)] disabled:opacity-30" title={asset.sizeBytes > 5 * 1024 * 1024 ? '原图超过 5 MB，请使用保存原图' : '通过云端凭据安全预览，不产生公开链接'}>
                    <Eye size={13} />{previewing === asset.id ? '读取中…' : '预览'}
                  </button>
                  <button disabled={downloading !== null} onClick={() => void savePrivateOriginal(asset)} className="inline-flex items-center gap-1 rounded-xl bg-[var(--surface-soft)] px-2.5 py-2 text-[11px] font-medium text-[var(--text-secondary)] disabled:opacity-30">
                    <Download size={13} />{downloading === asset.id ? '保存中…' : '保存原图'}
                  </button>
                  <button disabled={sharing !== null} onClick={() => void sharePrivateAsset(asset)} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800 disabled:opacity-30">
                    {copied === `share:${asset.id}` ? '限时链接已复制' : sharing === asset.id ? '生成中…' : '临时分享'}
                  </button>
                  </>
                )}
                <button disabled={!asset.publicUrl} onClick={() => copy(asset)} className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-soft)] px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:opacity-80 disabled:opacity-30" title={`复制为 ${outputFormatLabel[preferences.defaultFormat]}`}>
                  {copied === asset.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  {copied === asset.id ? '已复制' : `复制 ${outputFormatLabel[preferences.defaultFormat]}`}
                </button>
              </div>

              {asset.pluginOutputs?.length > 0 && <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                {asset.pluginOutputs.map((output) => { const key = `${asset.id}:${output.pluginId}`; return <div key={key} className="rounded-xl bg-[var(--surface-soft)] px-3 py-2">
                  <div className="flex items-center gap-2"><Plug size={11} className="text-indigo-500" /><span className="text-[10px] font-medium text-[var(--text-secondary)]">{output.pluginName}</span>{output.text && <button title="复制插件输出" onClick={() => void copyPluginOutput(asset.id, output.pluginId, output.text)} className="ml-auto rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface)]">{copied === key ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}</button>}</div>
                  {output.text && <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-secondary)]">{output.text}</div>}
                </div> })}
              </div>}
            </div>
          </article>
        ))}
      </section>
      {preview && (
        <div role="presentation" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4" onClick={() => setPreview(null)}>
          <div role="dialog" aria-modal="true" aria-label={`私有图片预览：${preview.name}`} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[var(--surface)] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm font-semibold">{preview.name}</div>
              <button onClick={() => setPreview(null)} className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]" title="关闭私有预览" aria-label="关闭私有预览"><X size={18} /></button>
            </div>
            <img src={preview.url} alt={preview.name} className="min-h-0 max-h-[70vh] w-full object-contain" />
            <p className="mt-3 text-xs text-[var(--text-muted)]">图片仅在本机当前预览窗口内存中显示，不会生成永久公开 URL；关闭后移除临时预览数据。</p>
          </div>
        </div>
      )}
      {assets.length >= assetLimit && (
        <div className="mt-5 text-center">
          <button
            onClick={() => setAssetLimit((current) => Math.min(current + 200, 10_000))}
            disabled={assetLimit >= 10_000}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] disabled:opacity-40"
          >
            {assetLimit >= 10_000 ? '已达到本地列表显示上限' : '加载更早的资源'}
          </button>
        </div>
      )}
    </div>
  )
}

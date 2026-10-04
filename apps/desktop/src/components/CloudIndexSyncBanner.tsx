import { AlertTriangle, CheckCircle2, Images, RefreshCw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listStorages, syncStorageAssetIndex } from '../lib/desktop'

interface CloudIndexSyncBannerProps {
  onOpenGallery: () => void
}

export function CloudIndexSyncBanner({ onOpenGallery }: CloudIndexSyncBannerProps) {
  const queryClient = useQueryClient()
  const { data: storages = [] } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const [message, setMessage] = useState<string | null>(null)
  const [hasWarning, setHasWarning] = useState(false)
  const enabledCount = storages.filter((storage) => storage.enabled).length

  const syncMutation = useMutation({
    mutationFn: () => syncStorageAssetIndex(),
    onMutate: () => {
      setMessage(null)
      setHasWarning(false)
    },
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
      setHasWarning(summary.errors.length > 0)
      setMessage(
        `扫描 ${summary.storagesScanned} 个云端、${summary.filesScanned} 个文件；新增 ${summary.imported} 张图片，已有 ${summary.skippedExisting} 张，跳过非图片 ${summary.skippedNonImages} 个${summary.errors.length ? `；${summary.errors.length} 项需要注意` : ''}。`,
      )
    },
    onError: (error) => {
      setHasWarning(true)
      setMessage(`同步失败：${String(error)}`)
    },
  })

  return (
    <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-6 text-blue-800">
      <div className="flex flex-wrap items-center gap-3">
        <Images size={16} className="shrink-0" />
        <div className="min-w-[280px] flex-1">
          <span className="font-semibold">资源索引可以同步已有云端图片。</span> 以前已经存在于 GitHub / Gitee / R2 / OSS / COS / WebDAV 的图片，可以加入资源页统一复制与管理；只记录元数据、公开 URL 和云端路径，不下载图片本体。
        </div>
        <button onClick={onOpenGallery} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-medium text-blue-700 shadow-sm">查看图库</button>
        <button
          disabled={!enabledCount || syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
          title={enabledCount ? `同步 ${enabledCount} 个已启用云端` : '请先连接并启用云端'}
        >
          <RefreshCw size={13} className={syncMutation.isPending ? 'animate-spin' : ''} />
          {syncMutation.isPending ? '同步中…' : '同步云端索引'}
        </button>
      </div>
      <div className="mt-1 pl-7 text-[11px] text-blue-700">为避免首次同步过载，每个云端单次最多扫描 2000 个文件；重复同步会跳过已经索引的同一云端路径。</div>
      {message && (
        <div className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2 ${hasWarning ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
          {hasWarning ? <AlertTriangle size={14} className="mt-1 shrink-0" /> : <CheckCircle2 size={14} className="mt-1 shrink-0" />}
          <span>{message}</span>
        </div>
      )}
    </div>
  )
}

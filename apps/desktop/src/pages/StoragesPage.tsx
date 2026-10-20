import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  FolderOpen,
  GitBranch,
  GitFork,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { notifyError, notifySuccess } from '../store/useToastStore'
import { confirmAction } from '../store/useConfirmStore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/PageHeader'
import { ReadFailurePanel } from '../components/ReadFailurePanel'
import { ProviderPickerDialog } from '../components/ProviderPickerDialog'
import { StorageBrowserDialog } from '../components/StorageBrowserDialog'
import { StorageGroupDialog } from '../components/StorageGroupDialog'
import { StorageSetupDialog } from '../components/StorageSetupDialog'
import {
  deleteStorage,
  deleteStorageGroup,
  getBootstrapSnapshot,
  getDefaultPublishTarget,
  setDefaultPublishTarget,
  listStorageGroups,
  listStorages,
  testStorage,
} from '../lib/desktop'
import type { StorageView, SupportedProviderKey } from '../types'

const providerIcon = (id: string, category: string) =>
  id === 'github' ? GitFork : id === 'gitee' ? GitBranch : category === 'protocol' ? Server : Cloud

function isSupportedProvider(id: string): id is SupportedProviderKey {
  return ['r2', 's3', 'oss', 'cos', 'github', 'gitee', 'webdav'].includes(id)
}

const strategyLabel = (strategy: string) =>
  strategy === 'mirror_all' ? '并行镜像' : '主存储 + 备份'

export function StoragesPage() {
  const queryClient = useQueryClient()
  const { openUpload, setPage } = useAppStore()
  const [recentlyAdded, setRecentlyAdded] = useState<Pick<StorageView, 'id' | 'name'> | null>(null)
  const { data } = useQuery({ queryKey: ['bootstrap'], queryFn: getBootstrapSnapshot })
  const { data: storages = [], isLoading, error: storagesError, refetch } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const { data: groups = [] } = useQuery({ queryKey: ['storage-groups'], queryFn: listStorageGroups })
  const { data: defaultTarget = null } = useQuery({ queryKey: ['default-publish-target'], queryFn: getDefaultPublishTarget })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [setup, setSetup] = useState<SupportedProviderKey | null>(null)
  const [browser, setBrowser] = useState<StorageView | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, boolean>>({})

  const removeGroupMutation = useMutation({
    mutationFn: deleteStorageGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-groups'] }),
  })

  const removeStorageMutation = useMutation({
    mutationFn: deleteStorage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['storages'] })
      await queryClient.invalidateQueries({ queryKey: ['storage-groups'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
  })

  const defaultTargetMutation = useMutation({
    mutationFn: ({ kind, id }: { kind: 'storage' | 'group'; id: string }) => setDefaultPublishTarget(kind, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['default-publish-target'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (error) => notifyError(`操作失败：${String(error)}`),
  })

  const recentlyAddedAvailable = recentlyAdded !== null && storages.some((storage) => storage.id === recentlyAdded.id)
  const recentlyAddedIsDefault = recentlyAddedAvailable
    && defaultTarget?.kind === 'storage'
    && defaultTarget.id === recentlyAdded?.id

  async function beginFirstUpload() {
    if (!recentlyAdded || !recentlyAddedAvailable || defaultTargetMutation.isPending) return
    if (!recentlyAddedIsDefault) {
      try {
        // Switching a previously configured default is always explicit in the CTA.
        await defaultTargetMutation.mutateAsync({ kind: 'storage', id: recentlyAdded.id })
      } catch {
        // The mutation displays the error. Stay on this screen for correction.
        return
      }
    }
    setPage('publish')
    openUpload('files')
  }

  const pickProvider = (provider: SupportedProviderKey) => {
    setPickerOpen(false)
    setSetup(provider)
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    try {
      const report = await testStorage(id)
      setTestResults((previous) => ({ ...previous, [id]: report.reachable }))
      if (report.reachable) notifySuccess(report.detail)
      else notifyError(`连接失败：${report.detail}`)
    } catch (error) {
      setTestResults((previous) => ({ ...previous, [id]: false }))
      notifyError(`连接失败：${String(error)}`)
    } finally {
      setTesting(null)
    }
  }

  const removeGroup = async (id: string, name: string) => {
    if (await confirmAction({ title: '删除多云组', detail: `删除多云组“${name}”吗？这不会删除任何云端文件或存储配置。`, confirmLabel: '删除' })) {
      removeGroupMutation.mutate(id)
    }
  }

  const removeStorage = async (id: string, name: string) => {
    if (await confirmAction({ title: '删除存储连接', detail: `删除存储“${name}”的连接配置吗？\n\n如果它仍被资源、多云组或内部上传配置引用，系统会拒绝删除。`, confirmLabel: '删除连接' })) {
      removeStorageMutation.mutate(id, {
        onError: (error) => notifyError(`操作失败：${String(error)}`),
      })
    }
  }

  return (
    <div className="mx-auto max-w-[1320px] px-10 py-9">
      <PageHeader
        title="云端"
        description="连接存储，并把多个云端组合成一次发布即可完成的 Storage Group。"
        action={
          <div className="flex items-center gap-2">
            <button disabled={storages.length < 2} onClick={() => setGroupOpen(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-35">
              <Layers3 size={16} /> 创建多云组
            </button>
            <button onClick={() => setPickerOpen(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">
              <Plus size={16} /> 添加存储
            </button>
          </div>
        }
      />

      {recentlyAddedAvailable && (
        <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-900">“{recentlyAdded?.name}”已连接并保存</div>
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              {recentlyAddedIsDefault
                ? '已成为当前默认上传目标。现在可以上传第一张图片；真实云端上传和外链仍需在发布后确认。'
                : '当前可能仍使用其他默认上传目标。你可以明确切换到这个存储，再上传第一张图片。'}
            </p>
          </div>
          <button disabled={defaultTargetMutation.isPending} onClick={() => void beginFirstUpload()} className="rounded-xl bg-emerald-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            {defaultTargetMutation.isPending ? '正在设置默认目标…' : recentlyAddedIsDefault ? '上传第一张图片 →' : '设为默认并上传 →'}
          </button>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">多云组</h2>
          <p className="mt-1 text-xs text-slate-400">定义 Primary / Mirror / Backup，一张图片可以自动发布到多个云端。</p>
        </div>
      </div>

      <section className="mt-4 grid grid-cols-3 gap-4">
        {groups.map((group) => (
          <article key={group.id} className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,.025)]">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Layers3 size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{group.name}</div>
                <div className="mt-1 text-[11px] text-slate-400">{strategyLabel(group.strategy)} · {group.members.length} 个云端</div>
              </div>
              <button onClick={() => void removeGroup(group.id, group.name)} className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500" title="删除多云组"><Trash2 size={14} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {group.members.map((member) => (
                <div key={member.storageId} className="flex items-center rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-slate-600">{member.storageName}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${member.role === 'primary' ? 'bg-slate-950 text-white' : member.role === 'mirror' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>{member.role}</span>
                </div>
              ))}
            </div>
            <button disabled={defaultTargetMutation.isPending || (defaultTarget?.kind === 'group' && defaultTarget.id === group.id)} onClick={() => defaultTargetMutation.mutate({ kind: 'group', id: group.id })} className={`mt-3 w-full rounded-xl px-3 py-2 text-xs font-medium ${defaultTarget?.kind === 'group' && defaultTarget.id === group.id ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-950 text-white'}`}>{defaultTarget?.kind === 'group' && defaultTarget.id === group.id ? '✓ 默认上传目标' : '设为默认上传目标'}</button>
          </article>
        ))}
        {!groups.length && (
          <button disabled={storages.length < 2} onClick={() => setGroupOpen(true)} className="col-span-3 rounded-[24px] border border-dashed border-slate-200 bg-white p-8 text-center disabled:cursor-not-allowed disabled:opacity-60">
            <div className="text-sm font-medium">{storages.length < 2 ? '连接至少两个存储后即可创建多云组' : '创建第一个多云组'}</div>
            <div className="mt-1 text-xs text-slate-400">例如 R2 作为 Primary，Gitee 作为 Backup。</div>
          </button>
        )}
      </section>

      <div className="mt-10 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">我的存储</h2>
          <p className="mt-1 text-xs text-slate-400">Token 与 Secret 保存在系统凭据库；SQLite 只保存非敏感配置和引用。</p>
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-2 text-xs text-slate-400"><RefreshCw size={13} /> 刷新</button>
      </div>

      <section className="mt-4 grid grid-cols-3 gap-4">
        {isLoading && <div className="text-sm text-slate-400">加载中…</div>}
        {storages.map((storage) => {
          const Icon = providerIcon(storage.providerKey, storage.category)
          return (
            <article key={storage.id} className="rounded-[22px] border border-slate-200/80 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-2xl bg-slate-100"><Icon size={18} /></div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{storage.name}</div>
                  <div className="truncate text-[11px] text-slate-400">{storage.providerKey.toUpperCase()} · {storage.detail}</div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">{defaultTarget?.kind === 'storage' && defaultTarget.id === storage.id && <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600">默认</span>}{testResults[storage.id] === true && <span className="flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 size={12} /> 已验证</span>}{testResults[storage.id] === false && <span className="text-[10px] text-red-500">连接失败</span>}</div>
                <button onClick={() => void removeStorage(storage.id, storage.name)} className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500" title="删除连接"><Trash2 size={14} /></button>
              </div>
              <div className={`mt-4 truncate text-[11px] ${storage.accessMode === 'private_requested' ? 'text-amber-700' : 'text-slate-400'}`}>{storage.accessMode === 'private_requested' ? '私有模式请求 · Bucket 是否公开尚未验证' : storage.publicBaseUrl || storage.publicHint}</div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => setBrowser(storage)} className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium"><FolderOpen size={13} /> 浏览</button>
                <button disabled={testing === storage.id} onClick={() => handleTest(storage.id)} className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium">
                  {testing === storage.id && <LoaderCircle size={13} className="animate-spin" />}测试连接
                </button>
                <button disabled={defaultTargetMutation.isPending || (defaultTarget?.kind === 'storage' && defaultTarget.id === storage.id)} onClick={() => defaultTargetMutation.mutate({ kind: 'storage', id: storage.id })} className={`col-span-2 rounded-xl px-3 py-2 text-xs font-medium ${defaultTarget?.kind === 'storage' && defaultTarget.id === storage.id ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-950 text-white'}`}>{defaultTarget?.kind === 'storage' && defaultTarget.id === storage.id ? '✓ 当前默认上传目标' : '设为默认上传目标'}</button>
              </div>
            </article>
          )
        })}
        {storagesError && !storages.length && (
          <ReadFailurePanel className="col-span-3 rounded-[24px] border border-dashed border-red-200 bg-red-50 p-10 text-center text-sm text-red-600" subject="云端列表" error={storagesError} />
        )}
        {!isLoading && !storages.length && !storagesError && (
          <div className="col-span-3 rounded-[24px] border border-dashed border-slate-200 bg-white p-10 text-center">
            <div className="text-sm font-medium">还没有云端存储</div>
            <div className="mt-1 text-xs text-slate-400">可以从 R2、GitHub 或 Gitee 开始，第一次连接只保留必要字段。</div>
            <button onClick={() => setPickerOpen(true)} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm text-white">添加第一个存储</button>
          </div>
        )}
      </section>

      <div className="mt-10">
        <h2 className="text-base font-semibold">官方 Provider</h2>
        <p className="mt-1 text-xs text-slate-400">R2 / S3 / OSS / COS / GitHub / Gitee / WebDAV 都可以作为默认上传目标或多云组成员。</p>
      </div>
      <section className="mt-4 grid grid-cols-3 gap-4">
        {data?.providers.map((provider) => {
          const Icon = providerIcon(provider.id, provider.category)
          const active = provider.status === 'available' && isSupportedProvider(provider.id)
          return (
            <article key={provider.id} className="rounded-[22px] border border-slate-200/80 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-2xl bg-slate-100"><Icon size={18} /></div>
                <div>
                  <div className="text-sm font-medium">{provider.name}</div>
                  <div className="text-[11px] text-slate-400">{provider.recommendedFor}</div>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><ShieldCheck size={12} /> 官方 Provider</span>
                <span>约 {provider.setupMinutes} 分钟</span>
              </div>
              <button disabled={!active} onClick={() => active && setSetup(provider.id as SupportedProviderKey)} className="mt-4 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-medium disabled:opacity-40">
                {active ? '开始配置' : '后续里程碑'}<ArrowRight size={14} />
              </button>
            </article>
          )
        })}
      </section>

      {pickerOpen && <ProviderPickerDialog onPick={pickProvider} onClose={() => setPickerOpen(false)} />}
      {setup && <StorageSetupDialog provider={setup} onClose={() => setSetup(null)} onCreated={(created) => {
        setRecentlyAdded({ id: created.id, name: created.name })
        notifySuccess(`已连接“${created.name}”，可以开始发布图片`)
      }} />}
      {browser && <StorageBrowserDialog storage={browser} onClose={() => setBrowser(null)} />}
      {groupOpen && <StorageGroupDialog storages={storages} onClose={() => setGroupOpen(false)} />}
    </div>
  )
}

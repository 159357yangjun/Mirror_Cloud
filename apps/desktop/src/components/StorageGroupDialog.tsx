import { useMemo, useState } from 'react'
import { Check, Layers3, LoaderCircle, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createStorageGroup } from '../lib/desktop'
import type {
  DeploymentRole,
  StorageGroupStrategy,
  StorageView,
} from '../types'

interface Props {
  storages: StorageView[]
  onClose: () => void
}

interface DraftMember {
  storageId: string
  role: DeploymentRole
  priority: number
}

export function StorageGroupDialog({ storages, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState<StorageGroupStrategy>('primary_with_backups')
  const [members, setMembers] = useState<DraftMember[]>([])

  const selectedIds = useMemo(() => new Set(members.map((member) => member.storageId)), [members])

  const mutation = useMutation({
    mutationFn: () =>
      createStorageGroup({
        name,
        strategy,
        members,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['storage-groups'] })
      onClose()
    },
  })

  function toggleStorage(storageId: string) {
    setMembers((current) => {
      const existing = current.find((member) => member.storageId === storageId)
      if (existing) {
        const next = current.filter((member) => member.storageId !== storageId)
        if (existing.role === 'primary' && next.length > 0) {
          return next.map((member, index) =>
            index === 0 ? { ...member, role: 'primary' as const } : member,
          )
        }
        return next
      }
      const role: DeploymentRole = current.some((member) => member.role === 'primary')
        ? 'backup'
        : 'primary'
      return [...current, { storageId, role, priority: current.length }]
    })
  }

  function setRole(storageId: string, role: DeploymentRole) {
    setMembers((current) =>
      current.map((member) => {
        if (member.storageId === storageId) return { ...member, role }
        if (role === 'primary' && member.role === 'primary') return { ...member, role: 'backup' }
        return member
      }),
    )
  }

  const canSubmit =
    name.trim().length > 0 &&
    members.length >= 2 &&
    members.filter((member) => member.role === 'primary').length === 1 &&
    !mutation.isPending

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <section className="w-full max-w-[680px] rounded-[28px] border border-white bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,.18)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-slate-100"><Layers3 size={19} /></div>
            <div>
              <h2 className="text-xl font-semibold">创建多云组</h2>
              <p className="mt-1 text-sm text-slate-400">一次发布到多个云端，并为每个存储定义主、镜像或备份角色。</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <label className="text-xs font-medium text-slate-500">
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：博客双云" className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
          </label>
          <label className="text-xs font-medium text-slate-500">
            策略
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as StorageGroupStrategy)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none">
              <option value="primary_with_backups">主存储 + 镜像 + 故障备份</option>
              <option value="mirror_all">并行镜像全部云端</option>
            </select>
          </label>
        </div>

        <div className="mt-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-sm font-semibold">选择存储</div>
              <div className="mt-1 text-xs text-slate-400">至少选择 2 个，并且只能有 1 个 Primary。Mirror 始终同步；Backup 仅在 Primary 失败时接管。</div>
            </div>
            <div className="text-xs text-slate-400">已选 {members.length}</div>
          </div>

          <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
            {storages.map((storage) => {
              const selected = selectedIds.has(storage.id)
              const member = members.find((item) => item.storageId === storage.id)
              return (
                <div key={storage.id} className={`flex items-center gap-3 rounded-2xl border p-3 transition ${selected ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => toggleStorage(storage.id)} className={`grid size-7 shrink-0 place-items-center rounded-lg border ${selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 text-transparent'}`}>
                    <Check size={13} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{storage.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">{storage.providerKey.toUpperCase()} · {storage.detail}</div>
                  </div>
                  {selected && member && (
                    <select value={member.role} onChange={(event) => setRole(storage.id, event.target.value as DeploymentRole)} className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs outline-none">
                      <option value="primary">Primary</option>
                      <option value="mirror">Mirror</option>
                      <option value="backup">Backup</option>
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {mutation.error && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{String(mutation.error)}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50">取消</button>
          <button disabled={!canSubmit} onClick={() => mutation.mutate()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-30">
            {mutation.isPending && <LoaderCircle size={15} className="animate-spin" />}
            创建多云组
          </button>
        </div>
      </section>
    </div>
  )
}

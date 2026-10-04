import { useEffect, useMemo, useState } from 'react'
import { Gauge, ImageDown, Layers3, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCustomWorkflow,
  createWorkflowFromRecipe,
  listStorageGroups,
  listStorages,
} from '../lib/desktop'
import type { RecipeView, WorkflowImageFormat, WorkflowTargetKind } from '../types'

interface Props {
  recipe?: RecipeView | null
  onClose: () => void
}

export function WorkflowSetupDialog({ recipe, onClose }: Props) {
  const queryClient = useQueryClient()
  const { data: storages = [] } = useQuery({ queryKey: ['storages'], queryFn: listStorages })
  const { data: groups = [] } = useQuery({ queryKey: ['storage-groups'], queryFn: listStorageGroups })
  const [name, setName] = useState(recipe?.name ?? '我的发布方案')
  const [description, setDescription] = useState(recipe?.description ?? '处理图片并发布到指定云端。')
  const [format, setFormat] = useState<WorkflowImageFormat>(recipe?.format ?? 'webp')
  const [quality, setQuality] = useState(recipe?.quality ?? 82)
  const [maxWidth, setMaxWidth] = useState<number | ''>(recipe?.maxWidth ?? 2560)
  const [maxHeight, setMaxHeight] = useState<number | ''>(recipe?.maxHeight ?? 2560)
  const [renameTemplate, setRenameTemplate] = useState(recipe?.renameTemplate ?? 'images/{year}/{month}/{hash:12}-{stem}.{ext}')
  const [target, setTarget] = useState('')
  const [setDefault, setSetDefault] = useState(true)

  useEffect(() => {
    if (!target) {
      if (groups[0]) setTarget(`group:${groups[0].id}`)
      else if (storages[0]) setTarget(`storage:${storages[0].id}`)
    }
  }, [groups, storages, target])

  const targetParts = useMemo(() => {
    const [kind, id] = target.split(':')
    return { kind: kind as WorkflowTargetKind, id }
  }, [target])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!targetParts.id || !['storage', 'group'].includes(targetParts.kind)) {
        throw new Error('请先选择发布目标')
      }
      if (recipe) {
        return createWorkflowFromRecipe({
          recipeKey: recipe.key,
          name,
          targetKind: targetParts.kind,
          targetId: targetParts.id,
          setDefault,
        })
      }
      return createCustomWorkflow({
        name,
        description,
        format,
        quality,
        maxWidth: maxWidth === '' ? null : maxWidth,
        maxHeight: maxHeight === '' ? null : maxHeight,
        renameTemplate,
        targetKind: targetParts.kind,
        targetId: targetParts.id,
        setDefault,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onClose()
    },
  })

  const noTarget = !groups.length && !storages.length

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <section className="max-h-[92vh] w-full max-w-[720px] overflow-auto rounded-[30px] border border-white bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,.2)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-indigo-600"><Sparkles size={14} />{recipe ? `基于 ${recipe.badge} Recipe` : '自定义 Workflow'}</div>
            <h2 className="mt-2 text-xl font-semibold">{recipe ? '添加发布方案' : '创建自定义方案'}</h2>
            <p className="mt-1 text-sm text-slate-400">普通用户只需选 Recipe 和目标；这些参数保留给需要精确控制的人。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <label className="col-span-2 text-xs font-medium text-slate-600">方案名称
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
          </label>
          {!recipe && (
            <label className="col-span-2 text-xs font-medium text-slate-600">说明
              <input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
            </label>
          )}

          {!recipe ? (
            <>
              <label className="text-xs font-medium text-slate-600">输出格式
                <select value={format} onChange={(event) => setFormat(event.target.value as WorkflowImageFormat)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none">
                  <option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="original">保持原格式</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">质量 · {quality}
                <input type="range" min={1} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-3 w-full accent-slate-950" />
              </label>
              <label className="text-xs font-medium text-slate-600">最大宽度
                <input type="number" min={1} value={maxWidth} onChange={(event) => setMaxWidth(event.target.value ? Number(event.target.value) : '')} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none" />
              </label>
              <label className="text-xs font-medium text-slate-600">最大高度
                <input type="number" min={1} value={maxHeight} onChange={(event) => setMaxHeight(event.target.value ? Number(event.target.value) : '')} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none" />
              </label>
              <label className="col-span-2 text-xs font-medium text-slate-600">远端命名模板
                <input value={renameTemplate} onChange={(event) => setRenameTemplate(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none" />
                <div className="mt-1 text-[11px] font-normal text-slate-400">支持 {'{year}'} {'{month}'} {'{day}'} {'{stem}'} {'{ext}'} {'{hash:12}'} {'{uuid}'}</div>
              </label>
            </>
          ) : (
            <div className="col-span-2 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-2"><ImageDown size={15} className="text-slate-400" /><div><div className="text-[11px] text-slate-400">格式</div><div className="text-sm font-medium uppercase">{recipe.format}</div></div></div>
              <div className="flex items-center gap-2"><Gauge size={15} className="text-slate-400" /><div><div className="text-[11px] text-slate-400">质量</div><div className="text-sm font-medium">{recipe.quality}</div></div></div>
              <div className="flex items-center gap-2"><Layers3 size={15} className="text-slate-400" /><div><div className="text-[11px] text-slate-400">最大尺寸</div><div className="text-sm font-medium">{recipe.maxWidth ? `${recipe.maxWidth}px` : '原图'}</div></div></div>
            </div>
          )}

          <label className="col-span-2 text-xs font-medium text-slate-600">发布目标
            <select disabled={noTarget} value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:opacity-50">
              {groups.length > 0 && <optgroup label="多云组">{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name} · {group.members.length} 个云端</option>)}</optgroup>}
              {storages.length > 0 && <optgroup label="单个存储">{storages.map((storage) => <option key={storage.id} value={`storage:${storage.id}`}>{storage.name} · {storage.providerKey.toUpperCase()}</option>)}</optgroup>}
            </select>
          </label>
        </div>

        <label className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <input type="checkbox" checked={setDefault} onChange={(event) => setSetDefault(event.target.checked)} className="size-4 accent-slate-950" />设为默认上传方案
        </label>

        {noTarget && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">请先在“云端”连接至少一个 Storage，再创建发布方案。</div>}
        {mutation.error && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{String(mutation.error)}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm">取消</button>
          <button disabled={noTarget || mutation.isPending || !name.trim()} onClick={() => mutation.mutate()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">
            {mutation.isPending && <LoaderCircle size={15} className="animate-spin" />}添加方案
          </button>
        </div>
      </section>
    </div>
  )
}

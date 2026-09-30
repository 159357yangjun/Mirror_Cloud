import { Check, ChevronRight, Gauge, ImageDown, Plus, Sparkles, Star, Trash2, Workflow } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { WorkflowSetupDialog } from '../components/WorkflowSetupDialog'
import { deleteWorkflow, listRecipes, listWorkflows, setDefaultWorkflow } from '../lib/desktop'
import { confirmAction } from '../store/useConfirmStore'
import type { RecipeView } from '../types'

export function WorkflowsPage() {
  const queryClient = useQueryClient()
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: listRecipes })
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: listWorkflows })
  const [setupRecipe, setSetupRecipe] = useState<RecipeView | null | undefined>(undefined)

  const defaultMutation = useMutation({
    mutationFn: setDefaultWorkflow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  return (
    <div className="mx-auto max-w-[1320px] px-10 py-9">
      <PageHeader
        title="方案"
        description="把图片处理、命名和发布目标组合成一个可重复使用的 Workflow。"
        action={<button onClick={() => setSetupRecipe(null)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"><Plus size={16} />自定义方案</button>}
      />

      <section className="mt-8 rounded-[26px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white"><Sparkles size={18} /></div>
          <div>
            <div className="text-sm font-semibold text-indigo-950">Recipe First</div>
            <p className="mt-1 max-w-3xl text-xs leading-6 text-indigo-700">新用户不需要理解 WebP、命名模板或多云策略。先选一个场景 Recipe，再指定发布目标即可；高级用户仍然可以建立自己的方案。</p>
          </div>
        </div>
      </section>

      <div className="mt-9"><h2 className="text-base font-semibold">推荐 Recipe</h2><p className="mt-1 text-xs text-slate-400">官方维护的少量高质量预设，而不是几十个看不懂的参数。</p></div>
      <section className="mt-4 grid grid-cols-2 gap-4">
        {recipes.map((recipe) => (
          <button key={recipe.key} onClick={() => setSetupRecipe(recipe)} className="group rounded-[24px] border border-slate-200/80 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_50px_rgba(15,23,42,.07)]">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-slate-100"><ImageDown size={17} /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{recipe.name}</span><span className={`rounded-full px-2 py-1 text-[10px] ${recipe.recommended ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>{recipe.badge}</span></div><p className="mt-1.5 text-xs leading-5 text-slate-400">{recipe.description}</p></div>
              <ChevronRight size={16} className="mt-1 text-slate-300 transition group-hover:translate-x-0.5" />
            </div>
            <div className="mt-5 flex items-center gap-4 text-[11px] text-slate-400"><span className="flex items-center gap-1"><ImageDown size={12} />{recipe.format.toUpperCase()}</span><span className="flex items-center gap-1"><Gauge size={12} />Q {recipe.quality}</span><span>{recipe.maxWidth ? `≤ ${recipe.maxWidth}px` : '保留原图'}</span></div>
          </button>
        ))}
      </section>

      <div className="mt-10"><h2 className="text-base font-semibold">我的方案</h2><p className="mt-1 text-xs text-slate-400">上传窗口默认只需要选择这里的一个方案。</p></div>
      <section className="mt-4 grid grid-cols-2 gap-4">
        {workflows.map((workflow) => (
          <article key={workflow.id} className="rounded-[24px] border border-slate-200/80 bg-white p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-slate-950 text-white"><Workflow size={17} /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><div className="truncate text-sm font-semibold">{workflow.name}</div>{workflow.isDefault && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] text-emerald-600"><Check size={10} />默认</span>}</div><div className="mt-1 truncate text-xs text-slate-400">{workflow.targetName}</div></div>
              <button onClick={() => { void confirmAction({ title: '删除方案', detail: `删除方案“${workflow.name}”吗？`, confirmLabel: '删除' }).then((accepted) => accepted && deleteMutation.mutate(workflow.id)) }} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] text-slate-400">格式</div><div className="mt-1 text-xs font-medium uppercase">{workflow.format}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] text-slate-400">质量</div><div className="mt-1 text-xs font-medium">{workflow.quality}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] text-slate-400">尺寸</div><div className="mt-1 text-xs font-medium">{workflow.maxWidth ? `${workflow.maxWidth}px` : '原图'}</div></div>
            </div>
            {!workflow.isDefault && <button disabled={defaultMutation.isPending} onClick={() => defaultMutation.mutate(workflow.id)} className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-950"><Star size={13} />设为默认</button>}
          </article>
        ))}
        {!workflows.length && <button onClick={() => recipes[0] && setSetupRecipe(recipes[0])} className="col-span-2 rounded-[24px] border border-dashed border-slate-200 bg-white p-10 text-center"><div className="text-sm font-medium">还没有发布方案</div><div className="mt-1 text-xs text-slate-400">建议从“博客 · WebP 均衡”开始，1 分钟完成。</div></button>}
      </section>

      {setupRecipe !== undefined && <WorkflowSetupDialog recipe={setupRecipe} onClose={() => setSetupRecipe(undefined)} />}
    </div>
  )
}

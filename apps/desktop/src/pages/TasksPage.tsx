import { AlertCircle, CheckCircle2, CircleDashed, LoaderCircle, RotateCcw, TriangleAlert, XCircle } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ReadFailurePanel } from '../components/ReadFailurePanel'
import { cancelTask, isTauriRuntime, listTasks, retryTask } from '../lib/desktop'
import type { TaskView } from '../types'

type TaskProgressEvent = { id: string; status: TaskView['status']; progress: number; error?: string | null }

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function TasksPage() {
  const queryClient = useQueryClient()
  const [taskLimit, setTaskLimit] = useState(100)
  const { data: tasks = [], error: tasksError, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', taskLimit],
    queryFn: () => listTasks(taskLimit),
    refetchInterval: 1500,
  })

  const cancelMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const retryMutation = useMutation({
    mutationFn: retryTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })

  useEffect(() => {
    if (!isTauriRuntime()) return
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<TaskProgressEvent>('task://updated', (event) => {
        const payload = event.payload
        // Progress ticks only patch the visible row; refetching the whole list (and every asset)
        // once per item made batch operations a refetch storm.
        queryClient.setQueryData<TaskView[]>(['tasks', taskLimit], (current) =>
          current?.map((task) => task.id === payload.id
            ? { ...task, status: payload.status, progress: payload.progress, error: payload.error ?? task.error }
            : task),
        )
        if (!TERMINAL_STATUSES.has(payload.status)) return
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        void queryClient.invalidateQueries({ queryKey: ['assets'] })
      }).then((cleanup) => {
        unlisten = cleanup
      }),
    )
    return () => unlisten?.()
  }, [queryClient, taskLimit])

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <PageHeader title="任务" description="单云发布、多云发布、修复与远端删除都由 Rust 后台任务引擎执行。" />
      <section className="mt-8 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
        {tasksLoading && <div className="grid min-h-[220px] place-items-center text-slate-300"><LoaderCircle size={22} className="animate-spin" /></div>}
        {!tasksLoading && !tasks.length && (tasksError ? <ReadFailurePanel className="p-10 text-center text-sm text-red-600" subject="任务" error={tasksError} /> : <div className="p-10 text-center text-sm text-slate-400">暂无任务</div>)}
        {tasks.map((task, index) => {
          const hasWarning = task.status === 'completed' && Boolean(task.error)
          const Icon =
            task.status === 'failed'
              ? AlertCircle
              : task.status === 'cancelled'
                ? XCircle
              : hasWarning
                ? TriangleAlert
                : task.status === 'completed'
                  ? CheckCircle2
                  : ['running', 'preparing'].includes(task.status)
                    ? LoaderCircle
                    : CircleDashed
          const iconClass =
            task.status === 'failed'
              ? 'bg-red-50 text-red-500'
              : task.status === 'cancelled'
                ? 'bg-slate-100 text-slate-500'
              : hasWarning
                ? 'bg-amber-50 text-amber-600'
                : task.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-500'
                  : 'bg-blue-50 text-blue-500'

          return (
            <div key={task.id} className={`flex items-center gap-4 p-5 ${index ? 'border-t border-slate-100' : ''}`}>
              <div className={`grid size-10 place-items-center rounded-2xl ${iconClass}`}>
                <Icon size={18} className={['running', 'preparing'].includes(task.status) ? 'animate-spin' : ''} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{task.title}</div>
                <div className={`mt-1 text-xs ${task.status === 'failed' ? 'text-red-500' : hasWarning ? 'text-amber-600' : 'text-slate-400'}`}>
                  {task.detail}{task.error ? ` · ${task.error}` : ''}
                </div>
                {['running', 'preparing', 'queued'].includes(task.status) && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${task.progress}%` }} />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {task.attempt > 0 && <div className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">重试 {task.attempt}/{task.maxAttempts}</div>}
                {task.canCancel && (
                  <button
                    onClick={() => cancelMutation.mutate(task.id)}
                    disabled={cancelMutation.isPending}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:opacity-40"
                  >
                    <XCircle size={12} />取消
                  </button>
                )}
                {task.canRetry && (
                  <button
                    onClick={() => retryMutation.mutate(task.id)}
                    disabled={retryMutation.isPending}
                    className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-medium text-indigo-700 disabled:opacity-40"
                  >
                    <RotateCcw size={12} />重试
                  </button>
                )}
                <div className="w-12 text-right text-xs font-medium text-slate-400">{task.progress}%</div>
              </div>
            </div>
          )
        })}
      </section>
      {(cancelMutation.error || retryMutation.error) && (
        <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs text-red-600">{String(cancelMutation.error || retryMutation.error)}</div>
      )}
      {tasks.length >= taskLimit && (
        <div className="mt-5 text-center">
          <button
            onClick={() => setTaskLimit((current) => Math.min(current + 100, 10_000))}
            disabled={taskLimit >= 10_000}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 disabled:opacity-40"
          >
            {taskLimit >= 10_000 ? '已达到任务显示上限' : '加载更早的任务'}
          </button>
        </div>
      )}
    </div>
  )
}

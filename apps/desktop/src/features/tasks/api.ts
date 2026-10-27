import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { TaskView } from '../../types'

export async function listTasks(limit = 100): Promise<TaskView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_tasks', { limit })
}

export async function cancelTask(taskId: string): Promise<void> {
  return invoke('cancel_task', { taskId })
}

export async function retryTask(taskId: string): Promise<string> {
  return invoke('retry_task', { taskId })
}

export function isTauriRuntime() {
  if (typeof window === 'undefined') return false
  const bridge = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } | null }).__TAURI_INTERNALS__
  return typeof bridge?.invoke === 'function'
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

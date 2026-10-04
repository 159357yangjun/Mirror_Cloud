import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useToastStore } from '../store/useToastStore'

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5 shadow-lg ${
            toast.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {toast.kind === 'error' ? (
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 break-words whitespace-pre-line">{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            // 24x24 is the floor the layout gate charges for a clickable target; the glyph stays 12px,
            // so this grows the hit area rather than the icon.
            className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded p-0.5 opacity-60 transition hover:opacity-100"
            title="关闭提示"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

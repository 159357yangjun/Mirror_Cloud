import { TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useConfirmStore } from '../store/useConfirmStore'

export function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request)
  const settle = useConfirmStore((state) => state.settle)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!request) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // A destructive confirmation must start on Cancel, never Confirm.
    cancelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        settle(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
        .filter((element) => element.getClientRects().length > 0)
      if (!controls.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [request, settle])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={() => settle(false)}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="theme-surface w-full max-w-[440px] rounded-[26px] border p-6 shadow-[0_35px_120px_rgba(15,23,42,.28)]"
      >
        <div className="flex items-start gap-3">
          <div className={`grid size-9 shrink-0 place-items-center rounded-2xl ${request.danger ? 'bg-red-50 text-red-600' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
            <TriangleAlert size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="break-words text-sm font-semibold">{request.title}</h2>
            <p className="mt-2 break-words text-xs leading-6 text-[var(--text-secondary)] whitespace-pre-line">{request.detail}</p>
          </div>
          <button onClick={() => settle(false)} className="shrink-0 rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-soft)]" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} onClick={() => settle(false)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]">
            {request.cancelLabel}
          </button>
          <button
            onClick={() => settle(true)}
            className={`rounded-xl px-4 py-2 text-xs font-medium text-white ${request.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)] hover:opacity-90'}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

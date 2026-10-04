import { TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useConfirmStore } from '../store/useConfirmStore'

export function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request)
  const settle = useConfirmStore((state) => state.settle)
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!request) return
    const dialog = dialogRef.current
    const overlay = dialog?.parentElement
    if (!dialog || !overlay) return
    const activeDialog = dialog as HTMLElement
    const inertSiblings = Array.from(overlay.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => [element, element.inert] as const)
    inertSiblings.forEach(([element]) => { element.inert = true })
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(activeDialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last || !activeDialog.contains(document.activeElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target?.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      inertSiblings.forEach(([element, wasInert]) => { element.inert = wasInert })
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [request, settle])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={() => settle(false)}>
      <section
        ref={dialogRef}
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

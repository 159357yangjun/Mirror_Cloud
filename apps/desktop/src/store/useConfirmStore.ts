import { create } from 'zustand'

export interface ConfirmSpec {
  title: string
  detail: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PendingConfirm extends ConfirmSpec {
  id: number
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  resolve: (accepted: boolean) => void
}

interface ConfirmState {
  request: PendingConfirm | null
  settle: (accepted: boolean) => void
}

let nextId = 1

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  settle: (accepted) => {
    const current = get().request
    if (!current) return
    set({ request: null })
    current.resolve(accepted)
  },
}))

// Resolves true only after the user confirms; dismissing, Escape and a superseded request all
// resolve false, so a dialog that never renders can never let a destructive action through.
export function confirmAction(spec: ConfirmSpec): Promise<boolean> {
  const { request, settle } = useConfirmStore.getState()
  if (request) settle(false)
  return new Promise<boolean>((resolve) => {
    useConfirmStore.setState({
      request: {
        ...spec,
        id: nextId++,
        confirmLabel: spec.confirmLabel ?? '确认',
        cancelLabel: spec.cancelLabel ?? '取消',
        danger: spec.danger ?? true,
        resolve,
      },
    })
  })
}

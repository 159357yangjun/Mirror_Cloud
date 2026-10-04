import { create } from 'zustand'

export type ToastKind = 'error' | 'success'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const VISIBLE_LIMIT = 4
const AUTO_DISMISS_MS = 8_000

interface ToastState {
  toasts: Toast[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let nextToastId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const toast: Toast = { id: nextToastId++, kind, message }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-VISIBLE_LIMIT) }))
    window.setTimeout(() => get().dismiss(toast.id), AUTO_DISMISS_MS)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export function notifyError(message: string) {
  useToastStore.getState().push('error', message)
}

export function notifySuccess(message: string) {
  useToastStore.getState().push('success', message)
}

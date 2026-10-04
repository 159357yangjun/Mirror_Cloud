import { create } from 'zustand'
import type { PageKey, UploadMode } from '../types'

interface AppState {
  page: PageKey
  uploadOpen: boolean
  requestedUploadMode: UploadMode
  queuedUploadPaths: string[]
  setPage: (page: PageKey) => void
  setUploadOpen: (open: boolean) => void
  openUpload: (mode?: UploadMode, paths?: string[]) => void
  clearQueuedUploadPaths: () => void
}

export const useAppStore = create<AppState>((set) => ({
  page: 'publish',
  uploadOpen: false,
  requestedUploadMode: 'files',
  queuedUploadPaths: [],
  setPage: (page) => set({ page }),
  setUploadOpen: (uploadOpen) => set({ uploadOpen }),
  openUpload: (requestedUploadMode = 'files', queuedUploadPaths = []) =>
    set({ uploadOpen: true, requestedUploadMode, queuedUploadPaths }),
  clearQueuedUploadPaths: () => set({ queuedUploadPaths: [] }),
}))

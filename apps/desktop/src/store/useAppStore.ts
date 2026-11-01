import type { SettingsSection } from '../features/settings/sections'
import { create } from 'zustand'
import type { PageKey, UploadMode } from '../types'

interface AppState {
  settingsSection: SettingsSection
  setSettingsSection: (section: SettingsSection) => void
  page: PageKey
  uploadOpen: boolean
  requestedUploadMode: UploadMode
  queuedUploadPaths: string[]
  /** A newer release seen at startup (cached or auto-checked). Drives the sidebar dot only. */
  updateAvailableVersion: string | null
  setUpdateAvailableVersion: (version: string | null) => void
  setPage: (page: PageKey) => void
  setUploadOpen: (open: boolean) => void
  openUpload: (mode?: UploadMode, paths?: string[]) => void
  clearQueuedUploadPaths: () => void
}

export const useAppStore = create<AppState>((set) => ({
  settingsSection: 'output',
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  page: 'publish',
  uploadOpen: false,
  requestedUploadMode: 'files',
  queuedUploadPaths: [],
  setPage: (page) => set({ page }),
  setUploadOpen: (uploadOpen) => set({ uploadOpen }),
  openUpload: (requestedUploadMode = 'files', queuedUploadPaths = []) =>
    set({ uploadOpen: true, requestedUploadMode, queuedUploadPaths }),
  clearQueuedUploadPaths: () => set({ queuedUploadPaths: [] }),
  updateAvailableVersion: null,
  setUpdateAvailableVersion: (updateAvailableVersion) => set({ updateAvailableVersion }),
}))

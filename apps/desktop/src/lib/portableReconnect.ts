import type { PortableStorageProfile } from './desktop'
import type { StorageView, SupportedProviderKey } from '../types'

export const PORTABLE_PROVIDERS: readonly SupportedProviderKey[] = [
  'r2', 's3', 'oss', 'cos', 'github', 'gitee', 'webdav',
]

export function portableProviderKey(profile: PortableStorageProfile): SupportedProviderKey | null {
  return PORTABLE_PROVIDERS.find((provider) => provider === profile.providerKey) ?? null
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

/** Conservative conflict guard: blocks a second local record, never edits the existing one. */
export function portableReconnectConflict(
  profile: PortableStorageProfile,
  storages: StorageView[],
): StorageView | undefined {
  return storages.find((storage) => {
    if (storage.providerKey !== profile.providerKey) return false
    if (normalize(storage.name) === normalize(profile.name)) return true
    if (profile.bucket && normalize(storage.detail) === normalize(profile.bucket)) return true
    if (profile.owner && profile.repo && profile.branch) {
      const expected = `${profile.owner}/${profile.repo} · ${profile.branch}`
      if (normalize(storage.detail) === normalize(expected)) return true
    }
    return false
  })
}

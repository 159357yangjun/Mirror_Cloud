import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { AssetView } from '../../types'

export async function listAssets(limit = 200): Promise<AssetView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_assets', { limit })
}

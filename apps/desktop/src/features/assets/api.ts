import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { AssetView } from '../../types'

export async function listAssets(limit = 200): Promise<AssetView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_assets', { limit })
}

export async function repairAsset(assetId: string): Promise<string> {
  return invoke('repair_asset', { assetId })
}

export async function deleteAsset(assetId: string): Promise<string> {
  return invoke('delete_asset', { assetId })
}

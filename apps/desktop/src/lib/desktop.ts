import { mockBootstrap, mockRecipes } from '../data/mock'
import { notifyError } from '../store/useToastStore'
import type {
  AssetView,
  BootstrapSnapshot,
  CreateObjectStorageInput,
  CreateRepositoryStorageInput,
  CreateS3StorageInput,
  CreateWebDavStorageInput,
  CreateStorageGroupInput,
  CreateWorkflowFromRecipeInput,
  CreateCustomWorkflowInput,
  OutputPreferences,
  RecipeView,
  StorageEntryView,
  StorageGroupView,
  StorageView,
  SystemDiagnosticsView,
  DefaultPublishTargetView,
  TaskView,
  TyporaIntegrationInfo,
  LocalApiInfo,
  GlobalShortcutInfo,
  WindowsContextMenuInfo,
  BatchStorageOperationView,
  WorkflowView,
  PluginExecutionLogView,
  PluginView,
  AiSettings,
  AiWorkflowPlan,
} from '../types'


export interface RemoteScanOutcome {
  storageId: string
  storageName: string
  completeness: 'complete' | 'partial' | 'unknown'
  stopReason:
    | 'exhausted'
    | 'file_limit'
    | 'directory_limit'
    | 'provider_error'
    | 'api_truncation'
  directoriesListed: number
  entriesSeen: number
  truncatedDirs: number
  errorCount: number
}

export interface RemoteIndexSyncResult {
  storagesScanned: number
  filesScanned: number
  imported: number
  skippedExisting: number
  skippedNonImages: number
  errors: string[]
  scans: RemoteScanOutcome[]
}

const docsBaseUrl = (import.meta.env.VITE_DOCS_BASE_URL || '').trim().replace(/\/+$/, '')

export function getDocsBaseUrl(): string | null {
  return docsBaseUrl || null
}

export function getProviderGuideUrl(provider: string): string | null {
  if (!docsBaseUrl) return null
  return `${docsBaseUrl}/guides/${encodeURIComponent(provider)}/`
}

export function getLocalApiGuideUrl(): string | null {
  if (!docsBaseUrl) return null
  return `${docsBaseUrl}/use/local-api/`
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只允许打开 http/https 外部地址')
  }
  if (isTauriRuntime()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  // `noopener` makes window.open return null by spec, so a null return here says nothing about
  // whether the popup was blocked; the browser branch can only report real rejections.
  window.open(url, '_blank', 'noopener,noreferrer')
}

// Every docs / external-link button used to discard the promise, so a rejected opener or a
// malformed baked-in base URL produced no toast, no inline error and no visible change.
export function openExternalUrlOrReport(url: string): void {
  openExternalUrl(url).catch((error) => notifyError(`打开链接失败：${String(error)}`))
}

export async function copyText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
    return
  }
  await navigator.clipboard.writeText(text)
}
export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function getBootstrapSnapshot(): Promise<BootstrapSnapshot> {
  if (!isTauriRuntime()) return mockBootstrap
  return invoke('bootstrap_snapshot')
}

export interface PortableStorageProfile {
  name: string
  providerKey: string
  bucket?: string | null
  region?: string | null
  root?: string | null
  owner?: string | null
  repo?: string | null
  branch?: string | null
  accessMode: 'unknown' | 'private_requested'
  sourceStorageId?: string | null
}

export interface PortableStorageManifest {
  schemaVersion: 1 | 2
  exportedAt: string
  credentialRebindRequired: true
  profiles: PortableStorageProfile[]
}

export async function exportPortableStorageManifest(destinationPath: string): Promise<number> {
  return invoke('export_portable_storage_manifest', { destinationPath })
}

export async function inspectPortableStorageManifest(sourcePath: string): Promise<PortableStorageManifest> {
  return invoke('inspect_portable_storage_manifest', { sourcePath })
}
export async function inspectPortableReconnectMap(
  sourcePath: string, manifest: PortableStorageManifest,
): Promise<PortableStorageIdMapping[]> {
  return invoke('inspect_portable_reconnect_map', { sourcePath, manifest })
}

export interface PortableStorageIdMapping {
  oldStorageId: string
  newStorageId: string
  providerKey: string
}

export async function exportPortableReconnectMap(
  destinationPath: string,
  sourceManifestExportedAt: string,
  mappings: PortableStorageIdMapping[],
): Promise<number> {
  return invoke('export_portable_reconnect_map', { destinationPath, sourceManifestExportedAt, mappings })
}

export interface PortableReferenceMember {
  sourceStorageId: string
  role: 'primary' | 'mirror' | 'backup'
  priority: number
}
export interface PortableReferenceGroup {
  sourceGroupId: string
  name: string
  strategy: 'mirror_all' | 'primary_with_backups'
  members: PortableReferenceMember[]
}
export interface PortableWorkflowSpec {
  format: 'original' | 'jpeg' | 'png' | 'webp'
  quality: number
  maxWidth?: number | null
  maxHeight?: number | null
  renameTemplate: string
}
export interface PortableReferenceWorkflow {
  sourceWorkflowId: string
  name: string
  targetKind: 'storage' | 'group' | 'unsupported'
  sourceTargetId: string
  spec?: PortableWorkflowSpec | null
}
export interface PortableGroupIdMapping {
  oldGroupId: string
  newGroupId: string
}
export interface PortableReferenceManifest {
  schemaVersion: 1 | 2
  exportedAt: string
  groups: PortableReferenceGroup[]
  workflows: PortableReferenceWorkflow[]
}
export interface PortableReferencePreview {
  groups: Array<{ sourceGroupId: string; name: string; status: string; detail: string }>
  workflows: Array<{ sourceWorkflowId: string; name: string; status: string; detail: string }>
}
export async function exportPortableReferenceManifest(destinationPath: string): Promise<number> {
  return invoke('export_portable_reference_manifest', { destinationPath })
}
export async function inspectPortableReferenceManifest(sourcePath: string): Promise<PortableReferenceManifest> {
  return invoke('inspect_portable_reference_manifest', { sourcePath })
}
export async function previewPortableReferenceRestore(
  manifest: PortableReferenceManifest, mappings: PortableStorageIdMapping[], groupMappings: PortableGroupIdMapping[],
): Promise<PortableReferencePreview> {
  return invoke('preview_portable_reference_restore', { manifest, mappings, groupMappings })
}
export async function exportPortableGroupMapping(
  destinationPath: string, manifest: PortableReferenceManifest,
  mappings: PortableStorageIdMapping[], groupMappings: PortableGroupIdMapping[],
): Promise<number> {
  return invoke('export_portable_group_mapping', { destinationPath, manifest, mappings, groupMappings })
}
export async function inspectPortableGroupMapping(
  sourcePath: string, expectedManifestExportedAt: string,
): Promise<PortableGroupIdMapping[]> {
  return invoke('inspect_portable_group_mapping', { sourcePath, expectedManifestExportedAt })
}
export async function restorePortableWorkflow(
  manifest: PortableReferenceManifest, mappings: PortableStorageIdMapping[],
  groupMappings: PortableGroupIdMapping[], sourceWorkflowId: string,
): Promise<string> {
  return invoke('restore_portable_workflow', { manifest, mappings, groupMappings, sourceWorkflowId })
}
export async function restorePortableStorageGroup(
  manifest: PortableReferenceManifest, mappings: PortableStorageIdMapping[], sourceGroupId: string,
): Promise<string> {
  return invoke('restore_portable_storage_group', { manifest, mappings, sourceGroupId })
}

export interface PortableAssetDeployment {
  sourceStorageId: string
  providerKey: string
  role: 'primary' | 'mirror' | 'backup'
  remotePath: string | null
}
export interface PortableAssetEntry {
  sourceAssetId: string
  sourceVariantId: string
  name: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  contentHash: string
  deployments: PortableAssetDeployment[]
}
export interface PortableAssetManifest {
  schemaVersion: 1
  exportedAt: string
  entries: PortableAssetEntry[]
}
export interface PortableAssetPreview {
  rows: Array<{
    sourceAssetId: string
    sourceVariantId: string
    name: string
    status: 'duplicate' | 'path_conflict' | 'needs_rebind' | 'unverified'
    detail: string
    resolvedCopies: number
    missingCopies: number
  }>
  duplicateVariants: number
  missingMappings: number
  remotePathConflicts: number
  applied: false
}
export async function exportPortableAssetManifest(destinationPath: string): Promise<number> {
  return invoke('export_portable_asset_manifest', { destinationPath })
}
export async function inspectPortableAssetManifest(sourcePath: string): Promise<PortableAssetManifest> {
  return invoke('inspect_portable_asset_manifest', { sourcePath })
}
export async function previewPortableAssetRestore(
  manifest: PortableAssetManifest, mappings: PortableStorageIdMapping[],
): Promise<PortableAssetPreview> {
  return invoke('preview_portable_asset_restore', { manifest, mappings })
}

export interface StagedAssetBatch {
  id: string
  sourceExportedAt: string
  createdAt: string
  itemCount: number
  awaitingVerification: number
  blockedCount: number
}
export interface StagedAssetRow {
  id: string
  batchId: string
  sourceAssetId: string
  sourceVariantId: string
  name: string
  reviewStatus: 'blocked_duplicate' | 'blocked_path' | 'needs_rebind' | 'awaiting_verification'
  resolvedCopies: number
  missingCopies: number
  operatorDecision: 'review' | 'defer' | 'exclude'
  revision: number
  sources: Array<{ sourceStorageId: string; providerKey: string; hasSafePath: boolean }>
  bindings: PortableStorageIdMapping[]
}
export async function stagePortableAssetManifest(
  manifest: PortableAssetManifest, mappings: PortableStorageIdMapping[],
): Promise<string> {
  return invoke('stage_portable_asset_manifest', { manifest, mappings })
}
export async function listPortableAssetStaging(): Promise<StagedAssetBatch[]> {
  return invoke('list_portable_asset_staging')
}
export async function listPortableStagedItems(batchId: string): Promise<StagedAssetRow[]> {
  return invoke('list_portable_staged_items', { batchId })
}
export async function updatePortableStagedItemReview(
  batchId: string, itemId: string, expectedRevision: number,
  decision: 'review' | 'defer' | 'exclude',
  sourceStorageId?: string, newStorageId?: string,
): Promise<void> {
  return invoke('update_portable_staged_item_review', {
    batchId, itemId, expectedRevision, decision, sourceStorageId, newStorageId,
  })
}

export interface PortableActivationGate {
  itemId: string
  revision: number
  localStatus: string
  decision: 'review' | 'defer' | 'exclude'
  gateStatus: 'excluded' | 'deferred' | 'blocked_local' | 'awaiting_remote_evidence'
  localBlockers: string[]
  copies: Array<{
    sourceStorageId: string
    destinationStorageId: string | null
    providerKey: string
    localBindingValid: boolean
    hasSafeObjectKey: boolean
    requiredEvidence: string[]
  }>
  activationAllowed: false
}
export async function assessPortableAssetActivation(
  batchId: string, itemId: string,
): Promise<PortableActivationGate> {
  return invoke('assess_portable_asset_activation', { batchId, itemId })
}

export type PortableStagedDecision = 'review' | 'defer' | 'exclude'
export interface PortableBatchDecisionItem {
  itemId: string
  expectedRevision: number
}
export async function applyPortableStagedBatchDecision(
  batchId: string, items: PortableBatchDecisionItem[], decision: PortableStagedDecision,
): Promise<number> {
  return invoke('apply_portable_staged_batch_decision', { batchId, items, decision })
}

export async function discardPortableAssetStaging(batchId: string): Promise<boolean> {
  return invoke('discard_portable_asset_staging', { batchId })
}

export async function listStorages(): Promise<StorageView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_storages')
}

export async function getDefaultPublishTarget(): Promise<DefaultPublishTargetView | null> {
  if (!isTauriRuntime()) return null
  return invoke('get_default_publish_target')
}

export async function setDefaultPublishTarget(targetKind: 'storage' | 'group', targetId: string): Promise<DefaultPublishTargetView> {
  return invoke('set_default_publish_target', { targetKind, targetId })
}

export async function createS3Storage(input: CreateS3StorageInput): Promise<StorageView> {
  return invoke('create_s3_storage', { input })
}

export async function createObjectStorage(input: CreateObjectStorageInput): Promise<StorageView> {
  return invoke('create_object_storage', { input })
}

export async function createWebDavStorage(input: CreateWebDavStorageInput): Promise<StorageView> {
  return invoke('create_webdav_storage', { input })
}

export async function createRepositoryStorage(
  input: CreateRepositoryStorageInput,
): Promise<StorageView> {
  return invoke('create_repository_storage', { input })
}


export async function deleteStorage(storageId: string): Promise<void> {
  return invoke('delete_storage', { storageId })
}

export async function listStorageGroups(): Promise<StorageGroupView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_storage_groups')
}

export async function createStorageGroup(
  input: CreateStorageGroupInput,
): Promise<StorageGroupView> {
  return invoke('create_storage_group', { input })
}

export async function deleteStorageGroup(groupId: string): Promise<void> {
  return invoke('delete_storage_group', { groupId })
}

export async function testStorage(storageId: string): Promise<{ reachable: boolean; detail: string }> {
  return invoke('test_storage', { storageId })
}

export async function browseStorage(storageId: string, path: string): Promise<StorageEntryView[]> {
  return invoke('browse_storage', { storageId, path })
}

export async function createTemporaryShareLink(
  storageId: string,
  path: string,
  expiresInSeconds: 600 | 3600 | 86400,
): Promise<string> {
  if (!isTauriRuntime()) throw new Error('临时分享仅在桌面应用中可用')
  return invoke('create_temporary_share_link', { storageId, path, expiresInSeconds })
}

export async function previewPrivateStorageEntry(
  storageId: string,
  path: string,
): Promise<{ mimeType: string; bytes: number[] }> {
  if (!isTauriRuntime()) throw new Error('私有图片预览仅在桌面应用中可用')
  return invoke('preview_private_storage_entry', { storageId, path })
}

export async function syncStorageAssetIndex(storageId?: string): Promise<RemoteIndexSyncResult> {
  return invoke('sync_storage_asset_index', { storageId: storageId || null })
}

export async function deleteStorageEntry(storageId: string, path: string): Promise<number> {
  return invoke('delete_storage_entry', { storageId, path })
}

export async function chooseDownloadPath(suggestedName: string): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggestedName })
}

export async function downloadStorageEntry(
  storageId: string,
  path: string,
  destinationPath: string,
): Promise<number> {
  return invoke('download_storage_entry', { storageId, path, destinationPath })
}

export async function moveStorageEntry(
  storageId: string,
  sourcePath: string,
  destinationPath: string,
): Promise<number> {
  return invoke('move_storage_entry', { storageId, sourcePath, destinationPath })
}

export async function createStorageDirectory(storageId: string, path: string): Promise<void> {
  return invoke('create_storage_directory', { storageId, path })
}

export async function batchDeleteStorageEntries(
  storageId: string,
  paths: string[],
): Promise<BatchStorageOperationView> {
  return invoke('batch_delete_storage_entries', { storageId, paths })
}

export async function batchMoveStorageEntries(
  storageId: string,
  paths: string[],
  destinationDir: string,
): Promise<BatchStorageOperationView> {
  return invoke('batch_move_storage_entries', { storageId, paths, destinationDir })
}

export async function batchRenameStorageEntries(
  storageId: string,
  paths: string[],
  template: string,
): Promise<BatchStorageOperationView> {
  return invoke('batch_rename_storage_entries', { storageId, paths, template })
}

export async function queueBatchDeleteStorageEntries(storageId: string, paths: string[]): Promise<string> {
  return invoke('queue_batch_delete_storage_entries', { storageId, paths })
}

export async function queueBatchMoveStorageEntries(storageId: string, paths: string[], destinationDir: string): Promise<string> {
  return invoke('queue_batch_move_storage_entries', { storageId, paths, destinationDir })
}

export async function queueBatchRenameStorageEntries(storageId: string, paths: string[], template: string): Promise<string> {
  return invoke('queue_batch_rename_storage_entries', { storageId, paths, template })
}


export async function listRecipes(): Promise<RecipeView[]> {
  if (!isTauriRuntime()) return mockRecipes
  return invoke('list_recipes')
}

export async function listWorkflows(): Promise<WorkflowView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_workflows')
}

export async function createWorkflowFromRecipe(
  input: CreateWorkflowFromRecipeInput,
): Promise<WorkflowView> {
  return invoke('create_workflow_from_recipe', { input })
}

export async function createCustomWorkflow(
  input: CreateCustomWorkflowInput,
): Promise<WorkflowView> {
  return invoke('create_custom_workflow', { input })
}

export async function setDefaultWorkflow(workflowId: string): Promise<void> {
  return invoke('set_default_workflow', { workflowId })
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  return invoke('delete_workflow', { workflowId })
}

export async function publishFilesWithWorkflow(
  workflowId: string,
  paths: string[],
): Promise<string[]> {
  return invoke('publish_files_with_workflow', { workflowId, paths })
}

export async function publishUrlsWithWorkflow(
  workflowId: string,
  urls: string[],
): Promise<string[]> {
  return invoke('publish_urls_with_workflow', { workflowId, urls })
}

export async function publishClipboardImageWithWorkflow(workflowId: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('剪贴板图片仅在桌面应用中可用')
  return invoke('publish_clipboard_image_with_workflow', { workflowId })
}

export async function chooseImageFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return []
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  })
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

export async function repairAsset(assetId: string): Promise<string> {
  return invoke('repair_asset', { assetId })
}

export async function deleteAsset(assetId: string): Promise<string> {
  return invoke('delete_asset', { assetId })
}

export async function listTasks(limit = 100): Promise<TaskView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_tasks', { limit })
}

export async function cancelTask(taskId: string): Promise<void> {
  return invoke('cancel_task', { taskId })
}

export async function retryTask(taskId: string): Promise<string> {
  return invoke('retry_task', { taskId })
}

export async function listAssets(limit = 200): Promise<AssetView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_assets', { limit })
}

export async function getOutputPreferences(): Promise<OutputPreferences> {
  if (!isTauriRuntime()) {
    return { defaultFormat: 'markdown', customTemplate: '![{name}]({url})', autoCopyAfterPublish: true, imageFormat: 'webp' }
  }
  return invoke('get_output_preferences')
}

export async function saveOutputPreferences(
  preferences: OutputPreferences,
): Promise<OutputPreferences> {
  if (!isTauriRuntime()) return preferences
  return invoke('save_output_preferences', { preferences })
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseNotes: string
  setupUrl: string
  setupBytes: number
  publishedAt: string
}

// G1 trust boundary: the backend keeps the verified installer record; the frontend
// only ever holds this opaque summary and passes the id back. Paths and a
// self-declared `verified` flag are deliberately NOT round-tripped through JS.
export interface DownloadedUpdateSummary {
  updateId: string
  version: string
  fileName: string
  bytes: number
  sha256: string
}

// The updater has no browser-mode mock on purpose: every state (idle/checking/available/downloaded)
// is only honest when it comes from the real GitHub API and the real installed version. In the
// dev browser the card renders its "检查更新" button as a call that fails with this message.
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return invoke('check_for_updates')
}

/** The cached outcome of the last completed check. Zero network: it reads what the backend stored. */
export interface UpdateStatus {
  checkedAt: string | null
  fresh: boolean
  result: UpdateCheckResult | null
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (!isTauriRuntime()) {
    return { checkedAt: null, fresh: false, result: null }
  }
  return invoke('get_update_status')
}

export async function downloadUpdate(check: UpdateCheckResult): Promise<DownloadedUpdateSummary> {
  return invoke('download_update', { check })
}

export async function installUpdate(updateId: string): Promise<void> {
  return invoke('install_update', { updateId })
}

export async function getTyporaIntegrationInfo(): Promise<TyporaIntegrationInfo> {
  if (!isTauriRuntime()) {
    return { command: '', executable: '', dataDir: '', defaultWorkflow: null, ready: false, message: '仅桌面应用支持 Typora 集成' }
  }
  return invoke('get_typora_integration_info')
}

export async function openTypora(): Promise<string> {
  return invoke('open_typora')
}

export async function openAppDataDir(): Promise<string> {
  return invoke('open_app_data_dir')
}

export async function getSystemDiagnostics(): Promise<SystemDiagnosticsView> {
  return invoke('get_system_diagnostics')
}

export async function getLocalApiInfo(): Promise<LocalApiInfo> {
  if (!isTauriRuntime()) {
    return {
      running: false,
      host: '127.0.0.1',
      port: 36677,
      baseUrl: 'http://127.0.0.1:36677',
      token: '',
      uploadEndpoint: 'http://127.0.0.1:36677/v1/upload',
      pathUploadEndpoint: 'http://127.0.0.1:36677/v1/upload-paths',
      securityNote: 'Local API is available only in the desktop app.',
    }
  }
  return invoke('get_local_api_info')
}

export async function regenerateLocalApiToken(): Promise<LocalApiInfo> {
  return invoke('regenerate_local_api_token')
}

export async function getGlobalShortcutInfo(): Promise<GlobalShortcutInfo> {
  if (!isTauriRuntime()) {
    return { shortcut: 'CommandOrControl+Shift+U', enabled: true, registered: false, action: '上传剪贴板图片并复制 URL', note: '桌面应用可用' }
  }
  return invoke('get_global_shortcut_info')
}

export async function setGlobalShortcutEnabled(enabled: boolean): Promise<GlobalShortcutInfo> {
  return invoke('set_global_shortcut_enabled', { enabled })
}

/// Interval floor mirrored from the backend (`MIN_INTERVAL_MINUTES`). Duplicated deliberately:
/// TypeScript cannot read a Rust const, and a UI that accepted 1 minute would be clamped silently on
/// save, showing the user a number that never took effect. Keeping the number here lets the control
/// refuse it at the point of entry instead.
export const MIN_RECONCILE_INTERVAL_MINUTES = 30
export const MAX_RECONCILE_INTERVAL_MINUTES = 7 * 24 * 60
// Mirrored from `MIN_SCAN_INTERVAL_MINUTES` / the 24h default for the same reason as above: a scan
// cadence the UI accepted and the backend silently raised would show a number that never took effect.
export const MIN_SCAN_INTERVAL_MINUTES = 60
export const DEFAULT_SCAN_INTERVAL_MINUTES = 24 * 60

export interface ReconciliationSettings {
  enabled: boolean
  intervalMinutes: number
  scanIntervalMinutes: number
}

export type ConfirmationTierName =
  | 'unknown'
  | 'uploaded'
  | 'remote_observed'
  | 'content_verified'
  | 'publicly_reachable'

export type TierStrengthName = 'strong' | 'weak' | 'unconfirmed'

/** §18B: the four buckets a failed probe is reported with (mirrors domain::ProbeFailureKind). */
export type ProbeFailureKindName = 'network_timeout' | 'auth_failed' | 'rejected' | 'unavailable'

/** One drift finding with the evidence this build can actually claim about it. */
export interface DriftEntry {
  deploymentId: string | null
  remotePath: string
  confirmation: ConfirmationTierName | null
  strength: TierStrengthName | null
  missingEvidence: string | null
  /** Set on probe-path rows only: why the lookup could not answer (§18B). */
  probeFailure?: ProbeFailureKindName | null
}

export interface SweepReport {
  examined: number
  present: number
  absent: number
  inconclusive: number
  missingRemote: number
  unrecordedRemote: number
  eventsRecorded: number
  truncated: boolean
  budgetExhausted: boolean
  nextCursor: string | null
  skippedByPolicy: boolean
  error: string | null
  // 'scan' = the set comparison used a stored listing; 'probe_only' = no fresh listing existed.
  evidenceSource: 'scan' | 'probe_only' | 'none'
  unrecordedPaths: DriftEntry[]
  probePaths: DriftEntry[]
  missingPaths: DriftEntry[]
  unknownPaths: DriftEntry[]
  pathsOmitted: number
}

// The inert default is restated in the browser build on purpose: outside Tauri there is no settings
// row to read, and showing "on" would claim a background job this runtime cannot run.
export const reconciliationDefaults: ReconciliationSettings = { enabled: false, intervalMinutes: 360, scanIntervalMinutes: DEFAULT_SCAN_INTERVAL_MINUTES }

export async function getReconciliationSettings(): Promise<ReconciliationSettings> {
  if (!isTauriRuntime()) {
    return reconciliationDefaults
  }
  return invoke('get_reconciliation_settings')
}

export async function setReconciliationSettings(
  enabled: boolean,
  intervalMinutes: number,
  scanIntervalMinutes: number,
): Promise<ReconciliationSettings> {
  // Clamped here as well as in the backend so the value rendered after saving is the value stored.
  const bounded = clamp(intervalMinutes, MIN_RECONCILE_INTERVAL_MINUTES, MAX_RECONCILE_INTERVAL_MINUTES)
  const boundedScan = clamp(scanIntervalMinutes, MIN_SCAN_INTERVAL_MINUTES, MAX_RECONCILE_INTERVAL_MINUTES)
  return invoke('set_reconciliation_settings', {
    enabled,
    intervalMinutes: bounded,
    scanIntervalMinutes: boundedScan,
  })
}

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(Math.max(value, floor), ceiling)
}

export async function runReconciliationSweep(): Promise<SweepReport> {
  return invoke('run_reconciliation_sweep')
}

/** What one recorded sweep says about itself. Scheduled records carry findings; manual ones are a line. */
export interface SweepHistoryEntry {
  lastSweepAt: string
  trigger: 'scheduled' | 'manual' | 'unknown'
  outcome: 'clean' | 'drift' | 'error' | 'skipped' | 'unknown'
  examined: number
  missingRemote: number
  unrecordedRemote: number
  unknownCoverage: number
  probeFailures?: number
  evidenceSource: string
  error: string | null
}

export interface ReconciliationHistory {
  last: Record<string, unknown>
  entries: SweepHistoryEntry[]
}

/** Read-back of what past sweeps recorded. The browser build has no settings row, so it returns an
 * empty history rather than inventing one - an empty panel says "nothing recorded", which a
 * fabricated entry would not. */
export async function getReconciliationHistory(): Promise<ReconciliationHistory> {
  if (!isTauriRuntime()) {
    return { last: {}, entries: [] }
  }
  return invoke('get_reconciliation_history')
}

export async function getWindowsContextMenuInfo(): Promise<WindowsContextMenuInfo> {
  if (!isTauriRuntime()) {
    return { supported: false, installed: false, label: '使用 Multi-cloud Publisher 上传', commandPreview: '', note: '仅 Windows 桌面应用可用' }
  }
  return invoke('get_windows_context_menu_info')
}

export async function installWindowsContextMenu(): Promise<WindowsContextMenuInfo> {
  return invoke('install_windows_context_menu')
}

export async function uninstallWindowsContextMenu(): Promise<WindowsContextMenuInfo> {
  return invoke('uninstall_windows_context_menu')
}



export async function listMarketplacePlugins(): Promise<PluginView[]> { return invoke('list_marketplace_plugins') }
export async function listPlugins(): Promise<PluginView[]> { return invoke('list_plugins') }
export async function listPluginExecutionLogs(limit = 40): Promise<PluginExecutionLogView[]> { return invoke('list_plugin_execution_logs', { limit }) }
export async function installMarketplacePlugin(pluginId: string): Promise<PluginView> { return invoke('install_marketplace_plugin', { pluginId }) }
export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> { return invoke('set_plugin_enabled', { pluginId, enabled }) }
export async function setPluginPermissions(pluginId: string, permissions: string[]): Promise<void> { return invoke('set_plugin_permissions', { pluginId, permissions }) }
export async function setPluginHooks(pluginId: string, hooks: string[]): Promise<void> { return invoke('set_plugin_hooks', { pluginId, hooks }) }
export async function savePluginConfig(pluginId: string, config: Record<string, unknown>): Promise<void> { return invoke('save_plugin_config', { pluginId, config }) }
export async function deletePlugin(pluginId: string): Promise<void> { return invoke('delete_plugin', { pluginId }) }
export async function runPlugin(pluginId: string, assetName: string, publicUrl: string, mimeType = 'image/*'): Promise<{text:string; data:unknown}> { return invoke('run_plugin', { pluginId, assetName, publicUrl, mimeType }) }
export async function getAiSettings(): Promise<AiSettings> { return invoke('get_ai_settings') }
export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> { return invoke('save_ai_settings', { settings }) }
export async function aiPlanWorkflow(request: string): Promise<AiWorkflowPlan> { return invoke('ai_plan_workflow', { request }) }

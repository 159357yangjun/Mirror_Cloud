import {
  Check,
  ClipboardCopy,
  Database,
  ExternalLink,
  KeyRound,
  Keyboard,
  MousePointerClick,
  LoaderCircle,
  Network,
  RotateCcw,
  RefreshCw,
  Shield,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StorageSetupDialog } from '../components/StorageSetupDialog'
import { portableProviderKey, portableReconnectConflict } from '../lib/portableReconnect'
import {
  copyText,
  checkForUpdates,
  downloadUpdate,
  getLocalApiInfo,
  getLocalApiGuideUrl,
  getSystemDiagnostics,
  getGlobalShortcutInfo,
  getWindowsContextMenuInfo,
  getOutputPreferences,
  exportPortableStorageManifest,
  inspectPortableStorageManifest,
  exportPortableReconnectMap,
  inspectPortableReconnectMap,
  exportPortableReferenceManifest,
  inspectPortableReferenceManifest,
  previewPortableReferenceRestore,
  restorePortableStorageGroup,
  exportPortableGroupMapping,
  inspectPortableGroupMapping,
  restorePortableWorkflow,
  exportPortableAssetManifest,
  inspectPortableAssetManifest,
  previewPortableAssetRestore,
  stagePortableAssetManifest,
  listPortableAssetStaging,
  listPortableStagedItems,
  discardPortableAssetStaging,
  listStorages,
  getReconciliationSettings,
  getUpdateStatus,
  getReconciliationHistory,
  runReconciliationSweep,
  setReconciliationSettings,
  DEFAULT_SCAN_INTERVAL_MINUTES,
  MIN_SCAN_INTERVAL_MINUTES,
  MIN_RECONCILE_INTERVAL_MINUTES,
  type ReconciliationSettings,
  type SweepHistoryEntry,
  type SweepReport,
  getTyporaIntegrationInfo,
  installUpdate,
  openAppDataDir,
  openExternalUrlOrReport,
  openTypora,
  regenerateLocalApiToken,
  setGlobalShortcutEnabled,
  installWindowsContextMenu,
  uninstallWindowsContextMenu,
  saveOutputPreferences,
} from '../lib/desktop'
import type { DownloadedUpdateSummary, UpdateCheckResult, PortableStorageManifest, PortableReferenceManifest, PortableReferencePreview, PortableStorageIdMapping, PortableGroupIdMapping, PortableAssetManifest, PortableAssetPreview } from '../lib/desktop'
import { useAppStore } from '../store/useAppStore'
import { confirmAction } from '../store/useConfirmStore'
import { tierDisplay, tierReason } from '../lib/confirmationDisplay'
import { probeDisplay } from '../lib/probeDisplay'
import type { ProbeFailureKindName } from '../lib/desktop'
import type { ConfirmationTierName } from '../lib/desktop'
import type { OutputFormat, OutputPreferences } from '../types'

// The colour comes from `tierDisplay`, never inline here: the same ladder is shown on the asset rows
// and a divergence between the two would mean one of them is lying about how much to trust a copy.
function TierChip({ tier }: { tier: ConfirmationTierName | null }) {
  const view = tierDisplay(tier)
  if (!view) return <span className="text-[10px] text-slate-300">无本地记录</span>
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${view.chipClass}`}>
      {view.label}
    </span>
  )
}

function ProbeChip({ kind }: { kind: ProbeFailureKindName | null | undefined }) {
  const view = probeDisplay(kind)
  if (!view) return <span className="text-[10px] text-slate-300">未命名</span>
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${view.chipClass}`}>
      {view.label}
    </span>
  )
}
const sweepOutcomeView: Record<SweepHistoryEntry['outcome'], { label: string; chipClass: string }> = {
  clean: { label: '无差异', chipClass: 'bg-emerald-50 text-emerald-700' },
  drift: { label: '有差异', chipClass: 'bg-amber-50 text-amber-700' },
  error: { label: '未完成', chipClass: 'bg-red-50 text-red-600' },
  skipped: { label: '未发送请求', chipClass: 'bg-slate-100 text-slate-500' },
  unknown: { label: '未知', chipClass: 'bg-slate-100 text-slate-500' },
}

function SweepOutcomeChip({ outcome }: { outcome: SweepHistoryEntry['outcome'] }) {
  const view = sweepOutcomeView[outcome] ?? sweepOutcomeView.unknown
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${view.chipClass}`}>{view.label}</span>
}

// An unparseable timestamp renders as itself rather than "Invalid Date": a stored record we cannot
// read should look broken, not like a sweep at the epoch.
function sweepTimeLabel(raw: string): string {
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString()
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const setPage = useAppStore((state) => state.setPage)
  const localApiGuideUrl = getLocalApiGuideUrl()
  // Reconciliation: the settings row is read once and re-read after each save, so the switch label
  // reflects what the backend stored rather than what was clicked. The interval keeps a separate
  // draft because an input that wrote through on every keystroke would persist while typing "3".
  const { data: reconcileSettings, error: reconcileError } = useQuery({
    queryKey: ['reconciliation-settings'],
    queryFn: getReconciliationSettings,
    refetchOnWindowFocus: false,
  })
  const [intervalDraft, setIntervalDraft] = useState<number>(MIN_RECONCILE_INTERVAL_MINUTES)
  const [scanDraft, setScanDraft] = useState<number>(DEFAULT_SCAN_INTERVAL_MINUTES)
  useEffect(() => {
    if (reconcileSettings) {
      setIntervalDraft(reconcileSettings.intervalMinutes)
      setScanDraft(reconcileSettings.scanIntervalMinutes)
    }
  }, [reconcileSettings])
  function intervalDraftChange(minutes: number) {
    setIntervalDraft(Number.isFinite(minutes) ? minutes : MIN_RECONCILE_INTERVAL_MINUTES)
  }
  const reconcileToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      setReconciliationSettings(
        enabled,
        reconcileSettings?.intervalMinutes ?? 360,
        reconcileSettings?.scanIntervalMinutes ?? DEFAULT_SCAN_INTERVAL_MINUTES,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-settings'] }),
  })
  const intervalSaveMutation = useMutation({
    mutationFn: (minutes: number) =>
      setReconciliationSettings(
        reconcileSettings?.enabled ?? false,
        minutes,
        reconcileSettings?.scanIntervalMinutes ?? DEFAULT_SCAN_INTERVAL_MINUTES,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-settings'] }),
  })
  // The scan cadence is saved on its own because it bounds a different cost: the probe interval caps
  // requests per row page, while one scan walks every directory of every enabled storage. A user who
  // raises one should not silently change the other.
  const scanIntervalSaveMutation = useMutation({
    mutationFn: (hours: number) =>
      setReconciliationSettings(
        reconcileSettings?.enabled ?? false,
        reconcileSettings?.intervalMinutes ?? 360,
        Math.round(hours * 60),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-settings'] }),
  })
  // Manual sweeps are not cached: each run is a fresh observation of the remote, and a stale report
  // would be indistinguishable from "nothing changed since last time".
  const [sweepReport, setSweepReport] = useState<SweepReport | null>(null)
  const sweepMutation = useMutation({
    mutationFn: runReconciliationSweep,
    onSuccess: (report) => {
      setSweepReport(report)
      queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] })
    },
  })
  // Persisted outcomes: what the background job recorded while nobody was watching, plus one line
  // per manual pass. Invalidated after a manual sweep so its record lands in the list.
  const { data: reconcileHistory } = useQuery({
    queryKey: ['reconciliation-history'],
    queryFn: getReconciliationHistory,
  })

  const { data } = useQuery({ queryKey: ['output-preferences'], queryFn: getOutputPreferences })
  const { data: typora, error: typoraError, isFetching: typoraChecking, refetch: refreshTypora } = useQuery({
    queryKey: ['typora-integration'],
    queryFn: getTyporaIntegrationInfo,
    refetchOnWindowFocus: false,
  })
  const { data: localApi, error: localApiError, refetch: refreshLocalApi } = useQuery({
    queryKey: ['local-api-integration'],
    queryFn: getLocalApiInfo,
    refetchOnWindowFocus: false,
  })
  const { data: diagnostics, error: diagnosticsError, isFetching: diagnosticsChecking, refetch: refreshDiagnostics } = useQuery({
    queryKey: ['system-diagnostics'],
    queryFn: getSystemDiagnostics,
    refetchOnWindowFocus: false,
  })
  const { data: globalShortcut, error: shortcutError } = useQuery({
    queryKey: ['global-shortcut-integration'],
    queryFn: getGlobalShortcutInfo,
    refetchOnWindowFocus: false,
  })
  const { data: contextMenu } = useQuery({
    queryKey: ['windows-context-menu-integration'],
    queryFn: getWindowsContextMenuInfo,
    refetchOnWindowFocus: false,
  })
  const [form, setForm] = useState<OutputPreferences>({ defaultFormat: 'markdown', customTemplate: '![{name}]({url})', autoCopyAfterPublish: true, imageFormat: 'webp' })
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [startingTypora, setStartingTypora] = useState(false)
  const [copiedApiToken, setCopiedApiToken] = useState(false)
  const [copiedApiExample, setCopiedApiExample] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [portableBusy, setPortableBusy] = useState(false)
  const [portableMessage, setPortableMessage] = useState<string | null>(null)
  const [portablePreview, setPortablePreview] = useState<PortableStorageManifest | null>(null)
  const [restoreIndex, setRestoreIndex] = useState<number | null>(null)
  // A new ID only exists after provider creation succeeded. Never reuse a source UUID.
  // This map is deliberately session-local until the user explicitly exports an audit receipt.
  const [reconnectedIds, setReconnectedIds] = useState<Map<number, string>>(() => new Map())
  const [importedStorageMappings, setImportedStorageMappings] = useState<PortableStorageIdMapping[]>([])
  const [referenceManifest, setReferenceManifest] = useState<PortableReferenceManifest | null>(null)
  const [referencePreview, setReferencePreview] = useState<PortableReferencePreview | null>(null)
  const [restoredGroupIds, setRestoredGroupIds] = useState<Map<string, string>>(() => new Map())
  const [restoredWorkflowIds, setRestoredWorkflowIds] = useState<Map<string, string>>(() => new Map())
  const [assetMigrationBusy, setAssetMigrationBusy] = useState(false)
  const [assetMigrationMessage, setAssetMigrationMessage] = useState<string | null>(null)
  const [assetManifest, setAssetManifest] = useState<PortableAssetManifest | null>(null)
  const [assetPreview, setAssetPreview] = useState<PortableAssetPreview | null>(null)
  const [selectedStagedBatch, setSelectedStagedBatch] = useState<string | null>(null)
  const { data: stagedAssetBatches = [], error: stagedBatchError } = useQuery({
    queryKey: ['portable-asset-staging'],
    queryFn: listPortableAssetStaging,
  })
  const { data: selectedStagedItems = [] } = useQuery({
    queryKey: ['portable-asset-staging-items', selectedStagedBatch],
    queryFn: () => listPortableStagedItems(selectedStagedBatch!),
    enabled: selectedStagedBatch !== null,
  })
  const { data: connectedStorages = [], isLoading: storagesLoading, error: storagesError } = useQuery({
    queryKey: ['storages'],
    queryFn: listStorages,
  })

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const mutation = useMutation({
    mutationFn: saveOutputPreferences,
    onSuccess: (saved) => queryClient.setQueryData(['output-preferences'], saved),
  })

  // Seeded from the backend cache: whatever the startup check (or a previous session's manual
  // click) learned is shown here without spending a request just to open a settings page.
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null)
  useEffect(() => {
    let cancelled = false
    void getUpdateStatus()
      .then((status) => {
        if (!cancelled && status.fresh && status.result) setUpdateCheck(status.result)
      })
      .catch(() => {
        // Silent: nothing cached simply renders as no detail block.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [updateDownloaded, setUpdateDownloaded] = useState<DownloadedUpdateSummary | null>(null)
  const checkUpdateMutation = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (result) => { setUpdateCheck(result); setUpdateDownloaded(null) },
  })
  const downloadUpdateMutation = useMutation({
    mutationFn: () => { if (!updateCheck) throw new Error('请先检查更新'); return downloadUpdate(updateCheck) },
    onSuccess: (downloaded) => setUpdateDownloaded(downloaded),
  })
  const installUpdateMutation = useMutation({
    mutationFn: () => { if (!updateDownloaded) throw new Error('请先下载安装包'); return installUpdate(updateDownloaded.updateId) },
  })
  const updateError = checkUpdateMutation.error || downloadUpdateMutation.error || installUpdateMutation.error

  const regenerateApiTokenMutation = useMutation({
    mutationFn: regenerateLocalApiToken,
    onSuccess: (info) => queryClient.setQueryData(['local-api-integration'], info),
  })

  const shortcutMutation = useMutation({
    mutationFn: setGlobalShortcutEnabled,
    onSuccess: (info) => queryClient.setQueryData(['global-shortcut-integration'], info),
  })

  const installContextMenuMutation = useMutation({
    mutationFn: installWindowsContextMenu,
    onSuccess: (info) => queryClient.setQueryData(['windows-context-menu-integration'], info),
  })

  const uninstallContextMenuMutation = useMutation({
    mutationFn: uninstallWindowsContextMenu,
    onSuccess: (info) => queryClient.setQueryData(['windows-context-menu-integration'], info),
  })

  async function copyTyporaCommand() {
    if (!typora?.command) return
    try {
      await copyText(typora.command)
      setCopiedCommand(true)
      setActionError(null)
      window.setTimeout(() => setCopiedCommand(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function launchTypora() {
    try {
      await openTypora()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function startTyporaSetup() {
    if (!typora?.command) return
    setStartingTypora(true)
    try {
      await copyText(typora.command)
      await openTypora()
      setCopiedCommand(true)
      setActionError(null)
      window.setTimeout(() => setCopiedCommand(false), 1800)
    } catch (error) {
      setActionError(String(error))
    } finally {
      setStartingTypora(false)
    }
  }

  async function showDataDir() {
    try {
      await openAppDataDir()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function copyApiToken() {
    if (!localApi?.token) return
    try {
      await copyText(localApi.token)
      setCopiedApiToken(true)
      setActionError(null)
      window.setTimeout(() => setCopiedApiToken(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function copyApiExample() {
    if (!localApi?.token) return
    const command = `curl.exe -X POST "${localApi.pathUploadEndpoint}" -H "Authorization: Bearer ${localApi.token}" -H "Content-Type: application/json" -d "{\\"paths\\":[\\"C:/path/image.png\\"]}"`
    try {
      await copyText(command)
      setCopiedApiExample(true)
      setActionError(null)
      window.setTimeout(() => setCopiedApiExample(false), 1400)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function regenerateApiToken() {
    if (!(await confirmAction({ title: '重置 Local API Token', detail: '重新生成后，之前配置在 ShareX、脚本或其他工具里的 Local API Token 会立即失效。继续吗？', confirmLabel: '重置 Token' }))) return
    try {
      await regenerateApiTokenMutation.mutateAsync()
      await refreshLocalApi()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function toggleGlobalShortcut(enabled: boolean) {
    try {
      await shortcutMutation.mutateAsync(enabled)
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function toggleWindowsContextMenu() {
    try {
      if (contextMenu?.installed) await uninstallContextMenuMutation.mutateAsync()
      else await installContextMenuMutation.mutateAsync()
      setActionError(null)
    } catch (error) {
      setActionError(String(error))
    }
  }

  async function exportPortablePlan() {
    if (portableBusy) return
    setPortableBusy(true)
    setPortableMessage(null)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const destination = await save({
        defaultPath: 'mirror-cloud-storage-manifest.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination) {
        const count = await exportPortableStorageManifest(destination)
        setPortableMessage(`已导出 ${count} 个存储配置的无密钥重连清单。它不包含图片、数据库、工作流或访问密钥。`)
      }
    } catch {
      setPortableMessage('导出失败；请检查文件位置或更换文件名（不会覆盖已有文件）。')
    } finally {
      setPortableBusy(false)
    }
  }

  function currentStorageMappings(): PortableStorageIdMapping[] {
    if (portablePreview?.schemaVersion !== 2) return []
    return portablePreview.profiles.flatMap((profile, index) => {
      const imported = importedStorageMappings.find((item) =>
        item.oldStorageId === profile.sourceStorageId && item.providerKey === profile.providerKey)
      const newStorageId = reconnectedIds.get(index) ?? imported?.newStorageId
      return profile.sourceStorageId && newStorageId
        ? [{ oldStorageId: profile.sourceStorageId, newStorageId, providerKey: profile.providerKey }]
        : []
    })
  }

  async function exportReferenceManifest() {
    if (portableBusy) return
    setPortableBusy(true)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const destination = await save({
        defaultPath: 'mirror-cloud-relationships.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination) {
        const count = await exportPortableReferenceManifest(destination)
        setPortableMessage(`已导出 ${count} 项多云组或工作流关系引用，未包含凭据或完整工作流步骤。`)
      }
    } catch {
      setPortableMessage('关系清单导出失败；不会覆盖已有文件。')
    } finally {
      setPortableBusy(false)
    }
  }

  function currentGroupMappings(groups = restoredGroupIds): PortableGroupIdMapping[] {
    return [...groups].map(([oldGroupId, newGroupId]) => ({ oldGroupId, newGroupId }))
  }

  async function previewReferencePlan(manifest: PortableReferenceManifest, groups = restoredGroupIds) {
    const preview = await previewPortableReferenceRestore(manifest, currentStorageMappings(), currentGroupMappings(groups))
    setReferencePreview(preview)
  }

  async function inspectReferencePlan() {
    if (portableBusy) return
    setPortableBusy(true)
    setReferenceManifest(null)
    setReferencePreview(null)
    setRestoredGroupIds(new Map())
    setRestoredWorkflowIds(new Map())
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const source = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (typeof source === 'string') {
        const manifest = await inspectPortableReferenceManifest(source)
        setReferenceManifest(manifest)
        await previewReferencePlan(manifest, new Map())
        setPortableMessage('关系清单检查完成：需要先完成对应存储 ID 映射，才能逐项恢复多云组。')
      }
    } catch {
      setPortableMessage('关系清单检查失败：版本、字段、UUID 或成员约束不符合要求。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function refreshReferencePlan() {
    if (portableBusy || !referenceManifest) return
    setPortableBusy(true)
    try {
      await previewReferencePlan(referenceManifest)
    } catch {
      setReferencePreview(null)
      setPortableMessage('映射预览失败：请检查目标存储是否仍存在、已启用且 Provider 匹配。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function restoreOneGroup(sourceGroupId: string) {
    if (portableBusy || !referenceManifest || !referencePreview) return
    const group = referencePreview.groups.find((item) => item.sourceGroupId === sourceGroupId)
    if (!group || group.status !== 'ready' || restoredGroupIds.has(sourceGroupId)) return
    const accepted = await confirmAction({
      title: '确认恢复多云组',
      detail: `将使用新的 Group ID 新建多云组“${group.name}”，只建立本地成员关系，不覆盖现有组，也不自动创建工作流。`,
      confirmLabel: '确认新建多云组',
      danger: false,
    })
    if (!accepted || portableBusy) return
    setPortableBusy(true)
    try {
      const id = await restorePortableStorageGroup(referenceManifest, currentStorageMappings(), sourceGroupId)
      setRestoredGroupIds((current) => new Map(current).set(sourceGroupId, id))
      await queryClient.invalidateQueries({ queryKey: ['storage-groups'] })
      await previewReferencePlan(referenceManifest, new Map(restoredGroupIds).set(sourceGroupId, id))
      setPortableMessage('多云组已新建。可导出 Group ID 映射并继续恢复标准工作流。')
    } catch {
      setReferencePreview(null)
      setPortableMessage('多云组恢复失败：可能存在目标冲突、缺失映射或权限意图冲突。未标记成功。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function exportGroupMapReceipt() {
    if (!referenceManifest || portableBusy || restoredGroupIds.size === 0) return
    setPortableBusy(true)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const destination = await save({
        defaultPath: 'mirror-cloud-group-id-map.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination) {
        const count = await exportPortableGroupMapping(
          destination, referenceManifest, currentStorageMappings(), currentGroupMappings(),
        )
        setPortableMessage(`已导出 ${count} 条经过组成员核对的 Group ID 映射。`)
      }
    } catch {
      setPortableMessage('无法导出组映射：文件重复或目标组的名称、成员关系已变化。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function importGroupMapReceipt() {
    if (!referenceManifest || portableBusy) return
    setPortableBusy(true)
    setReferencePreview(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const source = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (typeof source !== 'string') return
      const imported = await inspectPortableGroupMapping(source, referenceManifest.exportedAt)
      const groups = new Map(imported.map((item) => [item.oldGroupId, item.newGroupId]))
      await previewReferencePlan(referenceManifest, groups)
      setRestoredGroupIds(groups)
      setPortableMessage('组映射已载入并验证成员及角色，可继续恢复安全预设工作流。')
    } catch {
      setPortableMessage('组映射和当前关系清单不一致或目标已变化，未启用。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function restoreOneWorkflow(sourceWorkflowId: string) {
    if (portableBusy || !referenceManifest || !referencePreview || restoredWorkflowIds.has(sourceWorkflowId)) return
    const item = referencePreview.workflows.find((w) => w.sourceWorkflowId === sourceWorkflowId)
    if (!item || item.status !== 'ready') return
    const accepted = await confirmAction({
      title: '确认恢复标准工作流',
      detail: `新建“${item.name}”并重映射发布目标，不复用旧 ID、不覆盖旧工作流，也不会设为默认上传目标。`,
      confirmLabel: '确认新建工作流',
      danger: false,
    })
    if (!accepted || portableBusy) return
    setPortableBusy(true)
    try {
      const id = await restorePortableWorkflow(
        referenceManifest, currentStorageMappings(), currentGroupMappings(), sourceWorkflowId,
      )
      setRestoredWorkflowIds((current) => new Map(current).set(sourceWorkflowId, id))
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      await previewReferencePlan(referenceManifest)
      setPortableMessage('标准工作流已恢复，使用新 ID，原默认上传目标保持不变。')
    } catch {
      setReferencePreview(null)
      setPortableMessage('工作流恢复被阻止：映射、模板安全规则或同名冲突；未覆盖既有工作流。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function importStorageMapReceipt() {
    if (!portablePreview || portablePreview.schemaVersion !== 2 || portableBusy) return
    setPortableBusy(true)
    setReferencePreview(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const source = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (typeof source !== 'string') return
      const mappings = await inspectPortableReconnectMap(source, portablePreview)
      setImportedStorageMappings(mappings)
      setPortableMessage(`已验证并载入 ${mappings.length} 条 Storage ID 映射，请重新检查关系预览。`)
    } catch {
      setPortableMessage('存储映射载入失败：来源清单时间、UUID、Provider 或目标状态不匹配。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function exportAssetMigrationManifest() {
    if (assetMigrationBusy) return
    setAssetMigrationBusy(true)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const destination = await save({
        defaultPath: 'mirror-cloud-assets.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination) {
        const count = await exportPortableAssetManifest(destination)
        setAssetMigrationMessage(`已导出 ${count} 条资源变体清单。移除了签名 URL、在线状态及验证时间；未包含图片文件。`)
      }
    } catch {
      setAssetMigrationMessage('资源清单导出失败：可能是记录数超限、路径或文件名冲突，不会覆盖原文件。')
    } finally {
      setAssetMigrationBusy(false)
    }
  }

  async function inspectAssetMigrationManifest() {
    if (assetMigrationBusy) return
    setAssetMigrationBusy(true)
    setAssetManifest(null)
    setAssetPreview(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const source = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (typeof source === 'string') {
        const manifest = await inspectPortableAssetManifest(source)
        const preview = await previewPortableAssetRestore(manifest, currentStorageMappings())
        setAssetManifest(manifest)
        setAssetPreview(preview)
        setAssetMigrationMessage('清单已检查。预览为只读操作，没有写入图片、部署记录或在线状态。')
      }
    } catch {
      setAssetMigrationMessage('资源清单不受支持，包含不安全字段或无法检查本地目标。')
    } finally {
      setAssetMigrationBusy(false)
    }
  }

  async function refreshAssetMigrationPreview() {
    if (assetMigrationBusy || !assetManifest) return
    setAssetMigrationBusy(true)
    setAssetPreview(null)
    try {
      setAssetPreview(await previewPortableAssetRestore(assetManifest, currentStorageMappings()))
      setAssetMigrationMessage('已用当前 Storage ID 映射重新检查重复内容和对象路径冲突。')
    } catch {
      setAssetMigrationMessage('预览检查失败：本地存储不可用或映射已失效。')
    } finally {
      setAssetMigrationBusy(false)
    }
  }

  async function stageAssetMigration() {
    if (assetMigrationBusy || !assetManifest || !assetPreview || assetManifest.entries.length === 0) return
    const accepted = await confirmAction({
      title: '确认将资源元数据暂存到本机？',
      detail: `将保存 ${assetManifest.entries.length} 条元数据到独立待核验表。它们不会进入正式资源列表，也不能分享、删除或修复远端文件。冲突项同样只供人工排查。`,
      confirmLabel: '确认隔离暂存',
      danger: false,
    })
    if (!accepted || assetMigrationBusy) return
    setAssetMigrationBusy(true)
    try {
      const batchId = await stagePortableAssetManifest(assetManifest, currentStorageMappings())
      setSelectedStagedBatch(batchId)
      await queryClient.invalidateQueries({ queryKey: ['portable-asset-staging'] })
      setAssetMigrationMessage('已保存隔离暂存批次。即使关闭应用也可查看；未写入正式图片或部署表。')
    } catch {
      setAssetMigrationMessage('暂存失败：同一来源清单可能已经暂存，或数据库检查失败；未标记暂存成功。')
    } finally {
      setAssetMigrationBusy(false)
    }
  }

  async function discardAssetMigration(batchId: string) {
    if (assetMigrationBusy) return
    const accepted = await confirmAction({
      title: '丢弃待核验资源批次？',
      detail: '只删除本机隔离暂存记录，不删除正式图片、云端文件或现有部署。',
      confirmLabel: '丢弃暂存批次',
      danger: true,
    })
    if (!accepted || assetMigrationBusy) return
    setAssetMigrationBusy(true)
    try {
      const removed = await discardPortableAssetStaging(batchId)
      if (!removed) throw new Error('批次已不存在')
      if (selectedStagedBatch === batchId) setSelectedStagedBatch(null)
      await queryClient.invalidateQueries({ queryKey: ['portable-asset-staging'] })
      await queryClient.invalidateQueries({ queryKey: ['portable-asset-staging-items', batchId] })
      setAssetMigrationMessage('暂存批次已清理；正式资源及远端对象均未修改。')
    } catch {
      setAssetMigrationMessage('丢弃暂存失败，请核对本地数据库状态。')
    } finally {
      setAssetMigrationBusy(false)
    }
  }

  async function exportReconnectionMap() {
    if (portableBusy || !portablePreview || portablePreview.schemaVersion !== 2) return
    const mappings = currentStorageMappings()
    if (!mappings.length) return
    setPortableBusy(true)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const destination = await save({
        defaultPath: 'mirror-cloud-reconnect-mapping.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (destination) {
        const count = await exportPortableReconnectMap(destination, portablePreview.exportedAt, mappings)
        setPortableMessage(`已导出 ${count} 条旧 ID → 新 ID 映射。仅供后续恢复审核使用，不会恢复图片、工作流或多云组。`)
      }
    } catch {
      setPortableMessage('导出映射失败：请检查目标文件名和已重新连接的存储是否仍存在。')
    } finally {
      setPortableBusy(false)
    }
  }

  async function inspectPortablePlan() {
    if (portableBusy) return
    setPortableBusy(true)
    setPortableMessage(null)
    setPortablePreview(null)
    setRestoreIndex(null)
    setReconnectedIds(new Map())
    setImportedStorageMappings([])
    setReferencePreview(null)
    setRestoredGroupIds(new Map())
    setRestoredWorkflowIds(new Map())
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const source = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (typeof source === 'string') {
        const plan = await inspectPortableStorageManifest(source)
        setPortablePreview(plan)
        setPortableMessage('清单格式检查通过。请选择一项并手动重连，所有密钥必须重新输入；已有存储不会被覆盖。')
      }
    } catch {
      setPortableMessage('无法识别该清单：格式不受支持、包含多余字段或文件超过 1 MB。现有数据未修改。')
    } finally {
      setPortableBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1040px] px-10 py-9">
      <PageHeader title="设置" description="只保留真正可操作的应用设置；云端账号和密钥继续归属于对应 Storage。" />

      {actionError && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{actionError}</div>}

      <section className="mt-8 rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Database size={17} /> 存储配置迁移清单</div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-slate-500">
              导出云存储名称、Bucket、资源目录和私有意图，方便换电脑时照着重新连接。
              <strong>不是完整备份</strong>：不包含图片、资源索引、工作流、Endpoint、访问密钥或插件密钥。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={portableBusy} onClick={() => void exportReferenceManifest()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-40">导出组/工作流关系</button>
            <button disabled={portableBusy} onClick={() => void inspectReferencePlan()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-40">导入关系清单</button>
            <button disabled={portableBusy} onClick={() => void exportPortablePlan()} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{portableBusy ? '处理中…' : '导出无密钥清单'}</button>
            <button disabled={portableBusy} onClick={() => void inspectPortablePlan()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-40">导入前检查</button>
          </div>
        </div>
        {portableMessage && <p role="status" className="mt-3 text-xs leading-5 text-slate-600">{portableMessage}</p>}
        {portablePreview && <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-slate-700">清单版本 {portablePreview.schemaVersion} · {portablePreview.profiles.length} 个存储 · 已重连 {reconnectedIds.size} 个</div>
            <button type="button"
              disabled={portableBusy || restoreIndex !== null || portablePreview.schemaVersion !== 2 || currentStorageMappings().length === 0}
              onClick={() => void exportReconnectionMap()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium disabled:opacity-40">
              导出旧→新 ID 映射
            </button>
            <button type="button" disabled={portableBusy || portablePreview.schemaVersion !== 2}
              onClick={() => void importStorageMapReceipt()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium disabled:opacity-40">
              载入 Storage ID 映射
            </button>
          </div>
          {portablePreview.schemaVersion === 1 && <p className="mt-2 text-[11px] text-amber-700">旧版 v1 清单没有原始 Storage ID，可逐项重新连接，但无法生成可靠的 ID 映射；建议从旧设备重新导出 v2 清单。</p>}
          <p className="mt-2 text-[11px] text-slate-500">恢复前冲突预览：{portablePreview.profiles.filter((profile) => portableReconnectConflict(profile, connectedStorages)).length} 项与现有存储的名称或目标冲突；冲突项禁止新建。此检查不代表云端权限已验证。</p>
          <div className="mt-2 max-h-64 space-y-2 overflow-auto text-xs text-slate-600">
            {portablePreview.profiles.map((profile, index) => {
              const conflict = portableReconnectConflict(profile, connectedStorages)
              const newStorageId = reconnectedIds.get(index)
              const saved = Boolean(newStorageId)
              const providerKey = portableProviderKey(profile)
              return <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{profile.name} · {profile.providerKey.toUpperCase()}</div>
                  <div className="text-[11px] text-slate-500">
                    {profile.bucket || (profile.owner && profile.repo ? `${profile.owner}/${profile.repo}` : '须重新填写目标地址')}
                    {' · '}{profile.accessMode === 'private_requested' ? '私有意图（未验证）' : '访问模式待确认'}
                  </div>
                  {profile.sourceStorageId && <div className="mt-1 break-all text-[10px] text-slate-400">旧 Storage ID：{profile.sourceStorageId}</div>}
                  {newStorageId && <div className="mt-1 break-all text-[10px] text-emerald-700">新 Storage ID：{newStorageId}（仅记录映射，未恢复引用）</div>}
                  {conflict && !saved && <div className="mt-1 text-[11px] text-amber-700">本机已有同名或相同目标：{conflict.name}，禁止自动覆盖/重复建立。</div>}
                </div>
                <button type="button"
                  disabled={!providerKey || portableBusy || storagesLoading || Boolean(storagesError) || Boolean(conflict) || saved || restoreIndex !== null}
                  onClick={() => setRestoreIndex(index)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-700 disabled:opacity-40">
                  {saved ? '已重连' : conflict ? '目标冲突' : '逐项重新连接'}
                </button>
              </div>
            })}
          </div>
          {storagesError && <p role="alert" className="mt-2 text-xs text-red-700">无法读取本机已有存储，已停止重连以避免重复配置。</p>}
          {reconnectedIds.size > 0 && portablePreview.schemaVersion === 2 && <p className="mt-2 text-[11px] text-amber-700">ID 对照仅保存在本次页面会话中，请及时导出映射文件。导出前关闭页面会丢失对照；不会自动恢复工作流和资源记录。</p>}
          <p className="mt-2 text-[11px] leading-5 text-amber-700">每项都要手动复核 Endpoint/公开地址和权限、重新输入凭据、确认新增，并通过原有连接测试才能保存。不会覆盖本机已有配置或自动恢复资源索引、工作流。</p>
        </div>}
        {referenceManifest && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>关系清单 v{referenceManifest.schemaVersion} · {referenceManifest.groups.length} 个多云组 · {referenceManifest.workflows.length} 条工作流</strong>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={portableBusy || restoredGroupIds.size === 0} onClick={() => void exportGroupMapReceipt()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">导出 Group ID 映射</button>
              <button type="button" disabled={portableBusy} onClick={() => void importGroupMapReceipt()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">载入 Group ID 映射</button>
              <button type="button" disabled={portableBusy} onClick={() => void refreshReferencePlan()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">重新检查冲突</button>
            </div>
          </div>
          {!referencePreview && <p role="alert" className="mt-2 text-amber-700">当前预览无效。重新检查成功前不允许恢复。</p>}
          <div className="mt-2 space-y-2">
            {referencePreview?.groups.map((group) => {
              const restoredId = restoredGroupIds.get(group.sourceGroupId)
              return <div key={group.sourceGroupId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                <div className="min-w-0">
                  <div className="font-medium">{group.name} · {restoredId ? '已恢复' : group.status === 'ready' ? '可恢复' : '无法恢复'}</div>
                  <p className="text-[11px] text-slate-500">{restoredId ? `新 Group ID：${restoredId}` : group.detail}</p>
                </div>
                <button type="button" disabled={portableBusy || Boolean(restoredId) || group.status !== 'ready'}
                  onClick={() => void restoreOneGroup(group.sourceGroupId)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">
                  {restoredId ? '已创建' : '确认恢复该组'}
                </button>
              </div>
            })}
            {referencePreview?.workflows.map((workflow) => {
              const restoredId = restoredWorkflowIds.get(workflow.sourceWorkflowId)
              return <div key={workflow.sourceWorkflowId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                <div className="min-w-0">
                  <div className="font-medium">{workflow.name} · {restoredId ? '已创建工作流' : workflow.status === 'ready' ? '标准工作流可恢复' : '需人工处理'}</div>
                  <p className="mt-1 text-[11px] text-amber-700">{restoredId ? `新 Workflow ID：${restoredId}` : workflow.detail}</p>
                </div>
                <button type="button"
                  disabled={portableBusy || Boolean(restoredId) || workflow.status !== 'ready'}
                  onClick={() => void restoreOneWorkflow(workflow.sourceWorkflowId)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">
                  {restoredId ? '已恢复' : '确认恢复标准工作流'}
                </button>
              </div>
            })}
          </div>
          <p className="mt-2 text-[11px] text-amber-700">仅白名单中的标准重命名模板与处理步骤允许恢复；自定义工作流需人工重建。默认目标、资源索引和云端权限不迁移、不作真实性断言。</p>
        </div>}
      </section>

      <section className="mt-8 rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Database size={17} />图片资源元数据迁移 · P2</div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              只导出本地图片元数据、内容哈希与安全对象路径。签名 URL、访问密钥、旧在线状态和验证时间不会导出；
              本阶段仅检查冲突，绝不自动重建可删除或可分享的云端副本。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={assetMigrationBusy} onClick={() => void exportAssetMigrationManifest()}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:opacity-40">导出资源清单</button>
            <button type="button" disabled={assetMigrationBusy} onClick={() => void inspectAssetMigrationManifest()}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:opacity-40">导入并检查资源</button>
          </div>
        </div>
        {assetMigrationMessage && <p role="status" className="mt-3 text-xs text-slate-600">{assetMigrationMessage}</p>}
        {assetManifest && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>版本 {assetManifest.schemaVersion} · {assetManifest.entries.length} 条资源变体 · 尚未激活任何资源</strong>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={assetMigrationBusy} onClick={() => void refreshAssetMigrationPreview()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">刷新冲突预览</button>
              <button type="button" disabled={assetMigrationBusy || !assetPreview || assetManifest.entries.length === 0}
                onClick={() => void stageAssetMigration()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">确认隔离暂存</button>
            </div>
          </div>
          {assetPreview && <p className="mt-2 text-slate-600">
            重复内容 {assetPreview.duplicateVariants} · 缺失映射 {assetPreview.missingMappings} · 路径冲突 {assetPreview.remotePathConflicts}
          </p>}
          {!assetPreview && <p role="alert" className="mt-2 text-amber-700">预览无效，须重新检查。</p>}
          <div className="mt-2 max-h-64 space-y-2 overflow-auto">
            {assetPreview?.rows.map((item) => <div key={item.sourceVariantId} className="rounded-lg bg-white p-2">
              <div className="font-medium text-slate-700">{item.name} · {item.status}</div>
              <p className="mt-1 text-[11px] text-slate-500">{item.detail} · 已映射路径 {item.resolvedCopies} · 待修复 {item.missingCopies}</p>
            </div>)}
          </div>
          <p className="mt-2 text-[11px] text-amber-700">预览结果不是云端文件存在的证据。资源数据库导入、远端验证、图片内容迁移尚未完成。</p>
        </div>}
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-700">本机待核验批次（关闭软件后仍保留）</div>
          {stagedBatchError && <p role="alert" className="mt-1 text-xs text-red-700">暂存列表无法读取；请检查数据库迁移。</p>}
          {!stagedBatchError && stagedAssetBatches.length === 0 && <p className="mt-2 text-xs text-slate-500">暂无暂存记录。</p>}
          <div className="mt-2 space-y-2">
            {stagedAssetBatches.map((batch) => <div key={batch.id} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-700">{batch.itemCount} 条暂存 · {batch.awaitingVerification} 条待核验 · {batch.blockedCount} 条需处理</div>
                  <div className="mt-1 text-[11px] text-slate-500">来源快照：{batch.sourceExportedAt}</div>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={assetMigrationBusy} onClick={() => setSelectedStagedBatch(batch.id)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 disabled:opacity-40">查看</button>
                  <button type="button" disabled={assetMigrationBusy} onClick={() => void discardAssetMigration(batch.id)}
                    className="rounded-lg border border-red-200 px-2 py-1.5 text-red-700 disabled:opacity-40">丢弃</button>
                </div>
              </div>
              {selectedStagedBatch === batch.id && <div className="mt-2 max-h-52 space-y-1 overflow-auto border-t border-slate-100 pt-2">
                {selectedStagedItems.map((item) => <div key={item.id} className="rounded bg-slate-50 px-2 py-1 text-[11px]">
                  {item.name} · {item.reviewStatus} · 已映射 {item.resolvedCopies} / 待处理 {item.missingCopies}
                </div>)}
              </div>}
            </div>)}
          </div>
          <p className="mt-2 text-[11px] text-amber-700">这些数据与正式资源库物理隔离；现阶段不提供激活、在线确认、远端删除或分享操作。</p>
        </div>
      </section>

      {portablePreview && restoreIndex !== null && (() => {
        const index = restoreIndex
        const profile = portablePreview.profiles[index]
        const provider = profile && portableProviderKey(profile)
        if (!profile || !provider) return null
        return <StorageSetupDialog
          key={index}
          provider={provider}
          restoreProfile={profile}
          onCreated={(created) => { setReconnectedIds((current) => new Map(current).set(index, created.id)); setReferencePreview(null) }}
          onClose={() => setRestoreIndex(null)}
        />
      })()}

      <section className="mt-8 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-950"><Workflow size={17} /> Typora 集成</div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-indigo-700">Typora 的“自定义命令”会调用 镜云自动维护的上传链，并在上传成功后依次执行当前已启用插件，再把最终公网 URL 返回给 Typora。</p>
          </div>
          <button onClick={() => void refreshTypora()} className="flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-indigo-700">
            {typoraChecking ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新检测
          </button>
        </div>

        {typoraError && (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3">
            <div className="text-xs font-medium text-red-700">无法检查 Typora 桥接状态</div>
            <div className="mt-1 text-[11px] leading-5 text-red-600">{String(typoraError).replace(/^Error:\s*/i, '')}</div>
            <button onClick={() => void refreshTypora()} className="mt-2 rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-700">重新检查</button>
          </div>
        )}
        {!typoraError && (
        <div className={`mt-4 rounded-2xl border px-4 py-3 ${typora?.ready ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 grid size-7 place-items-center rounded-lg ${typora?.ready ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {typora?.ready ? <Check size={14} /> : <LoaderCircle size={14} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{typora?.ready ? '桥接已就绪' : '还需要完成上传配置'}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-500">{typora?.message || '正在检查自动上传链与云端连接…'}</div>
              {typora?.defaultWorkflow && <div className="mt-1 text-[11px] text-slate-400">自动上传链：{typora.defaultWorkflow}</div>}
            </div>
          </div>
        </div>
        )}

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-700">Typora 自定义上传命令</div>
          <div className="mt-2 break-all rounded-xl bg-slate-950 px-3 py-3 font-mono text-[11px] leading-5 text-slate-200">{typora?.command || (typoraError ? '命令暂不可用：桥接状态读取失败' : '正在生成…')}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!typora?.command || startingTypora} onClick={() => void startTyporaSetup()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-40">
              {startingTypora ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}复制命令并打开 Typora
            </button>
            <button disabled={!typora?.command} onClick={() => void copyTyporaCommand()} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium disabled:opacity-40">
              {copiedCommand ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedCommand ? '命令已复制' : '只复制命令'}
            </button>
            <button onClick={() => void launchTypora()} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium"><ExternalLink size={14} />只打开 Typora</button>
            <button onClick={() => setPage('plugins')} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium"><Workflow size={14} />管理上传插件</button>
          </div>
          <div className="mt-2 text-[11px] leading-5 text-slate-400">“复制命令并打开 Typora”只会把 Custom Command 放进剪贴板并启动 Typora，不会自动修改 Typora 设置。请继续在 Typora → 偏好设置 → 图像中手动选择“自定义命令”、粘贴并执行一次验证。</div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-[11px] text-slate-500 max-lg:grid-cols-2">
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">1</div><div className="mt-1">点击“复制命令并打开 Typora”（命令会复制到剪贴板）</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">2</div><div className="mt-1">Typora → 偏好设置 → 图像</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">3</div><div className="mt-1">上传服务选“自定义命令”并粘贴</div></div>
          <div className="rounded-xl bg-white/80 p-3"><div className="font-semibold text-slate-700">4</div><div className="mt-1">点击“验证图片上传选项”</div></div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">之后在 Typora 粘贴、拖入图片，或使用“上传所有本地图片”，都会调用 镜云默认上传链，并执行当前开启的插件。镜云界面不需要保持打开。</p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div className="rounded-[24px] border border-violet-100 bg-gradient-to-br from-violet-50/80 via-white to-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-950"><Keyboard size={17} /> 全局快捷上传</div>
              <p className="mt-1 text-xs leading-6 text-violet-800">不切换窗口：截图复制到剪贴板后按快捷键，Publisher 后台上传并把最终 URL 重新写入剪贴板。</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={globalShortcut?.enabled ?? false}
                disabled={shortcutMutation.isPending || !globalShortcut}
                onChange={(event) => void toggleGlobalShortcut(event.target.checked)}
                className="size-4 accent-violet-700"
              />启用
            </label>
          </div>
          <div className="mt-4 rounded-2xl border border-violet-100 bg-white p-4">
            <div className="text-[11px] font-medium text-slate-500">快捷键</div>
            <div className="mt-1 flex items-center justify-between gap-3"><span className="font-mono text-sm font-semibold text-slate-900">{globalShortcut?.shortcut || (shortcutError ? '读取失败' : '读取中…')}</span><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${!globalShortcut ? 'bg-slate-100 text-slate-500' : globalShortcut.registered ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{!globalShortcut ? (shortcutError ? '注册状态读取失败' : '正在检查…') : globalShortcut.registered ? '系统已注册' : '未占用系统快捷键'}</span></div>
            <div className="mt-2 text-[11px] leading-5 text-slate-400">{globalShortcut?.action || '上传剪贴板图片并复制最终 URL'}</div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-violet-800">{globalShortcut?.note || '复用默认 Workflow、多云策略与插件链。'}</p>
        </div>

        <div className="rounded-[24px] border border-amber-100 bg-gradient-to-br from-amber-50/80 via-white to-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-950"><MousePointerClick size={17} /> Windows 右键上传</div>
              <p className="mt-1 text-xs leading-6 text-amber-800">把 Publisher 安装到当前用户的图片右键菜单。无需管理员权限，右击图片即可后台发布。</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${contextMenu?.installed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {contextMenu?.installed ? '已安装' : '未安装'}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4">
            <div className="text-xs font-medium text-slate-700">{contextMenu?.label || '使用 Multi-cloud Publisher 上传'}</div>
            <div className="mt-1 text-[11px] leading-5 text-slate-400">{contextMenu?.note || '仅 Windows 桌面版可用。'}</div>
          </div>
          <button
            disabled={!contextMenu?.supported || installContextMenuMutation.isPending || uninstallContextMenuMutation.isPending}
            onClick={() => void toggleWindowsContextMenu()}
            className="mt-3 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-35"
          >
            {contextMenu?.installed ? '移除右键菜单' : '安装右键菜单'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-[24px] border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-950"><Network size={17} /> Local HTTP API</div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-sky-800">给 ShareX、脚本、Obsidian 插件和未来 Agent 使用的本机上传入口。它复用与 Typora 相同的默认 Workflow、插件和多云策略，不维护第二套上传逻辑。</p>
            {localApiGuideUrl && (
              <button type="button" onClick={() => openExternalUrlOrReport(localApiGuideUrl)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900">
                完整调用教程与状态码 <ExternalLink size={11} />
              </button>
            )}
          </div>
          <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${!localApi ? 'bg-slate-100 text-slate-500' : localApi.running ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{!localApi ? (localApiError ? '状态读取失败' : '正在检查服务…') : localApi.running ? '127.0.0.1 服务运行中' : '服务未监听'}</div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 max-md:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium text-slate-500">Base URL</div>
            <div className="mt-1 font-mono text-xs text-slate-800">{localApi ? localApi.baseUrl : localApiError ? '读取失败' : '正在读取本机服务信息…'}</div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">Bearer Token</div>
            <div className="mt-1 break-all rounded-xl bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-200">{localApi?.token ? '••••••••••••••••••••••••••••••••' : localApiError ? 'Token 读取失败' : '正在读取系统凭据库…'}</div>
          </div>
          <div className="flex min-w-44 flex-col gap-2">
            <button disabled={!localApi?.token} onClick={() => void copyApiToken()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-medium text-white disabled:opacity-40">{copiedApiToken ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedApiToken ? 'Token 已复制' : '复制 Token'}</button>
            <button disabled={!localApi?.token} onClick={() => void copyApiExample()} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium disabled:opacity-40">{copiedApiExample ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedApiExample ? '示例已复制' : '复制调用示例'}</button>
            <button disabled={regenerateApiTokenMutation.isPending} onClick={() => void regenerateApiToken()} className="flex items-center justify-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700 disabled:opacity-40"><RotateCcw size={14} />重置 Token</button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium text-slate-700">POST /v1/upload</div><div className="mt-1 text-[11px] leading-5 text-slate-400">直接发送图片二进制，并添加 <span className="font-mono">X-Publisher-Filename</span>。适合 ShareX、自定义脚本。</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium text-slate-700">POST /v1/upload-paths</div><div className="mt-1 text-[11px] leading-5 text-slate-400">JSON 提交本机图片路径数组。适合编辑器、自动化脚本和批量工具。</div></div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-800"><Shield size={14} className="mt-0.5 shrink-0" />{localApi?.securityNote || '仅监听 127.0.0.1，上传必须携带本机 Token。'}</div>
      </section>

      <section className="mt-6 rounded-[24px] border border-slate-200/80 bg-white p-5">
        <div className="flex items-start justify-between gap-6">
          <div><div className="text-sm font-semibold">链接输出</div><div className="mt-1 text-xs text-slate-400">资源页复制按钮以及应用内自动复制使用的格式。</div></div>
          <select value={form.defaultFormat} onChange={(event) => setForm((current) => ({ ...current, defaultFormat: event.target.value as OutputFormat }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none">
            <option value="markdown">Markdown</option><option value="url">URL</option><option value="html">HTML</option><option value="bbcode">BBCode</option><option value="custom">自定义</option>
          </select>
        </div>
        <label className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <div><div className="text-xs font-medium text-slate-700">发布完成后自动复制</div><div className="mt-0.5 text-[11px] text-slate-400">真正发布成功后才复制；失败任务不会写入剪贴板。</div></div>
          <input type="checkbox" checked={form.autoCopyAfterPublish} onChange={(event) => setForm((current) => ({ ...current, autoCopyAfterPublish: event.target.checked }))} className="size-4 accent-slate-950" />
        </label>
        <div className="mt-5 flex items-center justify-between gap-6 rounded-2xl bg-slate-50 px-4 py-3">
          <div><div className="text-xs font-medium text-slate-700">上传时的图片格式</div><div className="mt-0.5 text-[11px] text-slate-400">默认链对所有入口生效（Typora、快捷键、右键、HTTP API）。“保留原图”不压缩不改格式。</div></div>
          <select value={form.imageFormat} onChange={(event) => setForm((current) => ({ ...current, imageFormat: event.target.value as OutputPreferences['imageFormat'] }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none" title="保存后下一次上传生效">
            <option value="webp">WebP（默认，体积最小）</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="original">保留原图</option>
          </select>
        </div>
        <div className="mt-5"><label className="text-xs font-medium text-slate-600">自定义模板</label><input value={form.customTemplate} onChange={(event) => setForm((current) => ({ ...current, customTemplate: event.target.value }))} placeholder="![{name}]({url})" className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none focus:border-slate-400" /><div className="mt-1.5 text-[11px] text-slate-400">支持 {'{url}'} 与 {'{name}'}。GitHub 会使用 Raw URL。</div></div>
        {mutation.error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{String(mutation.error)}</div>}
        <div className="mt-4 flex justify-end"><button disabled={mutation.isPending} onClick={() => mutation.mutate(form)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">保存输出设置</button></div>
      </section>

      <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">后台对账</div>
            <div className="mt-1 text-xs leading-5 text-slate-400">
              定期把本地记录的“已上线”与远端实际存在的对象做比对，只报告差异，不删除、不改状态。默认关闭：开启后才会向各存储发起读取请求。
            </div>
          </div>
          <button
            disabled={reconcileToggleMutation.isPending}
            onClick={() => reconcileToggleMutation.mutate(!reconcileSettings?.enabled)}
            className="h-10 shrink-0 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title={reconcileSettings?.enabled ? '点击关闭后台对账' : '点击开启后台对账'}
          >
            {reconcileToggleMutation.isPending ? '保存中…' : reconcileSettings?.enabled ? '已开启' : '已关闭'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <label className="text-xs font-medium text-slate-600" htmlFor="reconcile-interval">扫描间隔（分钟）</label>
          <input
            id="reconcile-interval"
            type="number"
            min={MIN_RECONCILE_INTERVAL_MINUTES}
            step={30}
            value={reconcileSettings?.intervalMinutes ?? 360}
            disabled={!reconcileSettings?.enabled}
            onChange={(event) => intervalDraftChange(Number(event.target.value))}
            className="h-10 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:opacity-50"
          />
          <span className="text-[11px] text-slate-400">不低于 {MIN_RECONCILE_INTERVAL_MINUTES} 分钟；更小的值会被后端抬到该下限。</span>
          <button
            disabled={!reconcileSettings?.enabled || intervalSaveMutation.isPending}
            onClick={() => intervalSaveMutation.mutate(intervalDraft)}
            className="ml-auto h-9 rounded-xl bg-slate-950 px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            {intervalSaveMutation.isPending ? '保存中…' : '保存间隔'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <label className="text-xs font-medium text-slate-600" htmlFor="reconcile-scan-interval">云端索引刷新间隔（小时）</label>
          <input
            id="reconcile-scan-interval"
            type="number"
            min={Math.ceil(MIN_SCAN_INTERVAL_MINUTES / 60)}
            step={6}
            value={Math.round((reconcileSettings?.scanIntervalMinutes ?? DEFAULT_SCAN_INTERVAL_MINUTES) / 60)}
            disabled={!reconcileSettings?.enabled}
            onChange={(event) => setScanDraft(Number(event.target.value) * 60)}
            className="h-10 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:opacity-50"
          />
          <span className="text-[11px] text-slate-400">不低于 {Math.ceil(MIN_SCAN_INTERVAL_MINUTES / 60)} 小时。首次安装不会自动扫描，第一份快照由你点“同步云端索引”或“手动扫描”产生。</span>
          <button
            disabled={!reconcileSettings?.enabled || scanIntervalSaveMutation.isPending}
            onClick={() => scanIntervalSaveMutation.mutate(scanDraft)}
            className="ml-auto h-9 rounded-xl bg-slate-950 px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            {scanIntervalSaveMutation.isPending ? '保存中…' : '保存刷新间隔'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            disabled={sweepMutation.isPending}
            onClick={() => sweepMutation.mutate()}
            className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sweepMutation.isPending ? '扫描中…' : '立即扫描'}
          </button>
          <span className="text-[11px] text-slate-400">手动扫描不受开关限制，始终会读取远端。</span>
        </div>

        {sweepReport && (
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
            <div>
              本次核对 <span className="font-mono">{sweepReport.examined}</span> 条部署记录：远端存在{' '}
              <span className="font-mono">{sweepReport.present}</span> · 远端缺失 <span className="font-mono">{sweepReport.absent}</span> · 无法确认{' '}
              <span className="font-mono">{sweepReport.inconclusive}</span>
            </div>
            <div className="mt-1">
              写入历史 <span className="font-mono">{sweepReport.eventsRecorded}</span> 条 · 应存在却查不到{' '}
              <span className="font-mono">{sweepReport.missingRemote}</span> · 未记录却存在{' '}
              <span className="font-mono">{sweepReport.unrecordedRemote}</span>
            </div>
            {sweepReport.truncated && (
              <div className="mt-1 text-amber-700">本轮受行数上限截断，剩余部分会在下次扫描继续。</div>
            )}
            {sweepReport.error && <div className="mt-1 text-red-600">扫描未完成：{sweepReport.error}</div>}
            {sweepReport.skippedByPolicy && <div className="mt-1 text-slate-500">后台任务当前处于关闭状态，本轮未发送任何请求。</div>}
            <div className="mt-2 text-[11px] text-slate-500">
              差异依据：{sweepReport.evidenceSource === 'scan' ? '云端索引快照（24 小时内的完整扫描）' : sweepReport.evidenceSource === 'probe_only' ? '逐个对象探测（没有可用的近期快照）' : '本轮未产生集合比对'}
            </div>
            {(sweepReport.missingPaths.length > 0 || sweepReport.unrecordedPaths.length > 0 || sweepReport.unknownPaths.length > 0 || sweepReport.probePaths.length > 0) && (
              <div className="mt-2 space-y-2">
                {sweepReport.missingPaths.length > 0 && (
                  <div>
                    <div className="font-medium text-red-600">应存在但快照里没有</div>
                    <ul className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-white px-3 py-2 text-[11px]">
                      {sweepReport.missingPaths.map((entry) => (
                        <li key={entry.remotePath} className="flex flex-wrap items-baseline gap-2 py-0.5">
                          <TierChip tier={entry.confirmation} />
                          <span className="font-mono text-slate-500">{entry.remotePath}</span>
                          <span className="text-slate-400">{tierReason(entry)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sweepReport.unrecordedPaths.length > 0 && (
                  <div>
                    <div className="font-medium text-amber-700">云端有但本地没记录</div>
                    <ul className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-white px-3 py-2 text-[11px]">
                      {sweepReport.unrecordedPaths.map((entry) => (
                        <li key={entry.remotePath} className="flex flex-wrap items-baseline gap-2 py-0.5">
                          <TierChip tier={entry.confirmation} />
                          <span className="font-mono text-slate-500">{entry.remotePath}</span>
                          <span className="text-slate-400">{tierReason(entry)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sweepReport.probePaths.length > 0 && (
                  <div>
                    <div className="font-medium text-sky-700">探测失败（无法确认，不代表缺失）</div>
                    <ul className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-white px-3 py-2 text-[11px]">
                      {sweepReport.probePaths.map((entry) => (
                        <li key={entry.remotePath} className="flex flex-wrap items-baseline gap-2 py-0.5">
                          <ProbeChip kind={entry.probeFailure} />
                          <span className="font-mono text-slate-500">{entry.remotePath}</span>
                          <span className="text-slate-400">{probeDisplay(entry.probeFailure)?.hint ?? "本轮未能核对"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                            {sweepReport.unknownPaths.length > 0 && (
                  <div>
                    <div className="font-medium text-slate-500">覆盖不足，无法判断</div>
                    <ul className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-white px-3 py-2 text-[11px]">
                      {sweepReport.unknownPaths.map((entry) => (
                        <li key={entry.remotePath} className="flex flex-wrap items-baseline gap-2 py-0.5">
                          <TierChip tier={entry.confirmation} />
                          <span className="font-mono text-slate-400">{entry.remotePath}</span>
                          <span className="text-slate-400">{tierReason(entry)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sweepReport.pathsOmitted > 0 && (
                  <div className="text-[11px] text-slate-400">另有 {sweepReport.pathsOmitted} 条未列出（每类最多显示 20 条）。</div>
                )}
              </div>
            )}
          </div>
        )}
        {(reconcileToggleMutation.error || intervalSaveMutation.error || sweepMutation.error) && (
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
            {String(reconcileToggleMutation.error || intervalSaveMutation.error || sweepMutation.error)}
          </div>
        )}
        <div className="mt-4 rounded-2xl border border-slate-100 px-4 py-3">
          <div className="text-xs font-medium text-slate-600">对账记录</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-400">
            后台扫描会把完整结果留在这里（保留 7 天）；手动扫描只留一行，不会覆盖你回来时看到的最近一次后台结果。
          </div>
          {(reconcileHistory?.entries.length ?? 0) === 0 ? (
            <div className="mt-2 text-[11px] text-slate-400">尚无记录：还没有完成过一次后台或手动扫描。</div>
          ) : (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px]">
              {reconcileHistory!.entries.map((entry: SweepHistoryEntry) => (
                <li key={entry.lastSweepAt} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-slate-500">{sweepTimeLabel(entry.lastSweepAt)}</span>
                  <span className="text-slate-400">{entry.trigger === 'scheduled' ? '后台' : entry.trigger === 'manual' ? '手动' : '未知来源'}</span>
                  <SweepOutcomeChip outcome={entry.outcome} />
                  <span className="text-slate-400">
                    核对 {entry.examined} · 缺失 {entry.missingRemote} · 未记录 {entry.unrecordedRemote} · 无法判断 {entry.unknownCoverage}
                  </span>
                  {entry.error && <span className="text-red-600">{entry.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="text-sm font-semibold">关于与更新</div><div className="mt-1 text-xs leading-5 text-slate-400">检查 GitHub Releases 的新版本；下载的安装包必须通过 sha256 校验才会被启动。配置、索引和密钥保存在系统目录，更新不会触碰。</div></div>
          <div className="flex shrink-0 flex-col items-end gap-1"><span className="font-mono text-[11px] text-slate-400">v{__APP_VERSION__}</span><button disabled={checkUpdateMutation.isPending} onClick={() => checkUpdateMutation.mutate()} className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">{checkUpdateMutation.isPending ? '检查中…' : '检查更新'}</button></div>
        </div>
        {updateCheck && (
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
            <div>当前版本 <span className="font-mono">v{updateCheck.currentVersion}</span> · 最新版本 <span className="font-mono">v{updateCheck.latestVersion}</span>{updateCheck.publishedAt ? ` · 发布于 ${updateCheck.publishedAt.slice(0, 10)}` : ''}</div>
            {updateCheck.updateAvailable ? (
              <>
                <div className="mt-1 font-medium text-slate-800">有新版本可安装（安装包 {(updateCheck.setupBytes / 1024 / 1024).toFixed(1)} MB）。</div>
                {updateCheck.releaseNotes && <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-[11px] text-slate-500">{updateCheck.releaseNotes}</p>}
                {!updateDownloaded ? (
                  <button disabled={downloadUpdateMutation.isPending} onClick={() => downloadUpdateMutation.mutate()} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{downloadUpdateMutation.isPending ? '下载并校验中…' : '下载更新'}</button>
                ) : (
                  <div className="mt-3">
                    <div className="text-[11px] text-emerald-700">已下载并通过 sha256 校验（{updateDownloaded.bytes.toLocaleString()} B）。</div>
                    <button disabled={installUpdateMutation.isPending} onClick={() => void confirmAction({ title: '立即安装更新？', detail: '应用会关闭并静默覆盖安装；配置和数据不受影响。完成后请重新打开镜云。', danger: false, confirmLabel: '安装并退出' }).then((ok) => ok && installUpdateMutation.mutate())} className="mt-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{installUpdateMutation.isPending ? '安装器已启动，应用即将退出…' : '立即安装'}</button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1 text-emerald-700">已是最新版本。</div>
            )}
          </div>
        )}
        {updateError && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{String(updateError)}</div>}
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <button onClick={() => setPage('storages')} className="rounded-[22px] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><KeyRound size={16} /></div><div><div className="text-sm font-medium">凭据与云端</div><div className="mt-0.5 text-xs text-slate-400">管理 GitHub Token、R2 Secret 和其他 Storage</div></div></div>
          <div className="mt-4 text-xs font-medium text-indigo-600">打开云端管理 →</div>
        </button>
        <button onClick={() => void showDataDir()} className="rounded-[22px] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><Database size={16} /></div><div><div className="text-sm font-medium">本地索引数据</div><div className="mt-0.5 text-xs text-slate-400">打开 SQLite、任务状态与应用配置所在目录</div></div></div>
          <div className="mt-4 text-xs font-medium text-indigo-600">打开数据目录 →</div>
        </button>
      </section>

      <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2 text-sm font-semibold"><Shield size={16} /> 系统诊断</div><div className="mt-1 text-xs leading-5 text-slate-400">集中检查本地数据库、默认上传链、Local API、Storage、插件和任务状态。</div></div>
          <button onClick={() => void refreshDiagnostics()} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">{diagnosticsChecking ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新检查</button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          {[
            ['Storage', diagnostics ? `${diagnostics.enabledStorageCount}/${diagnostics.storageCount} 启用` : '—'],
            ['插件', diagnostics ? `${diagnostics.enabledPluginCount}/${diagnostics.pluginCount} 启用` : '—'],
            ['任务', diagnostics ? `${diagnostics.activeTaskCount} 运行 · ${diagnostics.failedTaskCount} 失败` : '—'],
            ['Local API', diagnostics ? (diagnostics.localApiRunning ? '运行中' : '未运行') : '—'],
          ].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold text-slate-700">{value}</div></div>)}
        </div>
        {diagnosticsError ? (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3">
            <div className="text-xs font-medium text-red-700">系统诊断读取失败</div>
            <div className="mt-1 text-[11px] leading-5 text-red-600">{String(diagnosticsError).replace(/^Error:\s*/i, '')}</div>
          </div>
        ) : (
        <div className={`mt-4 rounded-2xl border px-4 py-3 ${diagnostics?.status === 'healthy' ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
          <div className="text-xs font-medium text-slate-700">{!diagnostics ? '正在检查核心状态…' : diagnostics.status === 'healthy' ? '核心状态正常' : '有项目需要处理'}</div>
          <div className="mt-1 text-[11px] text-slate-500">版本 {diagnostics?.appVersion || '—'} · 默认上传链：{diagnostics ? diagnostics.defaultWorkflow || '未配置' : '—'}</div>
          {!!diagnostics?.warnings.length && <div className="mt-2 space-y-1">{diagnostics.warnings.map((warning) => <div key={warning} className="text-[11px] text-amber-700">• {warning}</div>)}</div>}
        </div>
        )}
      </section>

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex items-center gap-2 text-sm font-medium"><Shield size={16} /> 安全说明</div>
        <p className="mt-2 text-xs leading-6 text-slate-500">Token 与 Secret 仍然保存在系统凭据库，Typora 命令本身不包含 Token。Typora 只把本地图片路径交给 Publisher，Publisher 再读取同一套上传配置、插件开关和凭据完成上传。</p>
      </div>

      <div className="mt-6 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5"><div className="flex items-center gap-2 text-sm font-medium text-indigo-900"><Sparkles size={16} /> 现在的交互原则</div><p className="mt-2 max-w-2xl text-xs leading-6 text-indigo-700">不再放看起来可以点、实际却没有行为的“装饰设置”。页面上出现的按钮都对应真实操作；纯状态信息会明确以说明文本展示。</p></div>
    </div>
  )
}

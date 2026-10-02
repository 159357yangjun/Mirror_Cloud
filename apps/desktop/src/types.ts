export type PageKey = 'publish' | 'assets' | 'storages' | 'gallery' | 'plugins' | 'tasks' | 'settings'
export type SupportedProviderKey = 'r2' | 's3' | 'oss' | 'cos' | 'github' | 'gitee' | 'webdav'
export type OutputFormat = 'url' | 'markdown' | 'html' | 'bbcode' | 'custom'
export type UploadMode = 'files' | 'urls' | 'clipboard'
export type StorageGroupStrategy = 'mirror_all' | 'primary_with_backups'
export type DeploymentRole = 'primary' | 'mirror' | 'backup'
export type WorkflowTargetKind = 'storage' | 'group'
export type WorkflowImageFormat = 'original' | 'jpeg' | 'png' | 'webp'

export interface ProviderSummary {
  id: string
  name: string
  category: 'object' | 'repository' | 'protocol'
  recommendedFor: string
  setupMinutes: number
  status: 'available' | 'planned'
}

export interface BootstrapSnapshot {
  appName: string
  version: string
  providers: ProviderSummary[]
}

export interface StorageView {
  id: string
  name: string
  providerKey: string
  category: string
  enabled: boolean
  detail: string
  publicBaseUrl?: string | null
  publicHint: string
}


export interface DefaultPublishTargetView {
  kind: 'storage' | 'group'
  id: string
  name: string
}

export interface StorageEntryView {
  name: string
  path: string
  isDir: boolean
  sizeBytes?: number | null
  publicUrl?: string | null
}

export interface BatchStorageFailureView {
  path: string
  error: string
}

export interface BatchStorageOperationView {
  succeeded: number
  deploymentsUpdated: number
  failures: BatchStorageFailureView[]
}

export interface CreateS3StorageInput {
  providerKey: 'r2' | 's3'
  name: string
  accountId?: string
  endpoint?: string
  region?: string
  bucket: string
  root?: string
  publicBaseUrl?: string
  accessKeyId: string
  secretAccessKey: string
}

export interface CreateObjectStorageInput {
  providerKey: 'oss' | 'cos'
  name: string
  endpoint: string
  bucket: string
  root?: string
  publicBaseUrl?: string
  accessKeyId: string
  secretAccessKey: string
}

export interface CreateWebDavStorageInput {
  name: string
  endpoint: string
  root?: string
  publicBaseUrl?: string
  username: string
  password: string
}

export interface CreateRepositoryStorageInput {
  providerKey: 'github' | 'gitee'
  name: string
  owner: string
  repo: string
  branch: string
  root?: string
  publicBaseUrl?: string
  token: string
}

export interface CreateStorageGroupInput {
  name: string
  strategy: StorageGroupStrategy
  members: Array<{
    storageId: string
    role: DeploymentRole
    priority: number
  }>
}

export interface StorageGroupView {
  id: string
  name: string
  strategy: StorageGroupStrategy
  members: Array<{
    storageId: string
    storageName: string
    providerKey: string
    role: DeploymentRole
    priority: number
  }>
}

export interface RecipeView {
  key: string
  name: string
  description: string
  badge: string
  format: WorkflowImageFormat
  quality: number
  maxWidth?: number | null
  maxHeight?: number | null
  renameTemplate: string
  recommended: boolean
}

export interface WorkflowView {
  id: string
  name: string
  description: string
  sourceRecipe?: string | null
  isDefault: boolean
  format: WorkflowImageFormat
  quality: number
  maxWidth?: number | null
  maxHeight?: number | null
  renameTemplate: string
  targetKind: WorkflowTargetKind
  targetId: string
  targetName: string
}

export interface CreateWorkflowFromRecipeInput {
  recipeKey: string
  name?: string
  targetKind: WorkflowTargetKind
  targetId: string
  setDefault: boolean
}

export interface CreateCustomWorkflowInput {
  name: string
  description?: string
  format: WorkflowImageFormat
  quality: number
  maxWidth?: number | null
  maxHeight?: number | null
  renameTemplate: string
  targetKind: WorkflowTargetKind
  targetId: string
  setDefault: boolean
}


export interface TyporaIntegrationInfo {
  command: string
  executable: string
  dataDir: string
  defaultWorkflow?: string | null
  ready: boolean
  message: string
}



export interface GlobalShortcutInfo {
  shortcut: string
  enabled: boolean
  registered: boolean
  action: string
  note: string
}

export interface WindowsContextMenuInfo {
  supported: boolean
  installed: boolean
  label: string
  commandPreview: string
  note: string
}

export interface LocalApiInfo {
  running: boolean
  host: string
  port: number
  baseUrl: string
  token: string
  uploadEndpoint: string
  pathUploadEndpoint: string
  securityNote: string
}

export interface SystemDiagnosticsView {
  status: 'healthy' | 'attention'
  appVersion: string
  dataDir: string
  databaseReady: boolean
  localApiRunning: boolean
  storageCount: number
  enabledStorageCount: number
  pluginCount: number
  enabledPluginCount: number
  taskCount: number
  activeTaskCount: number
  failedTaskCount: number
  defaultWorkflow?: string | null
  warnings: string[]
}

export interface OutputPreferences {
  defaultFormat: OutputFormat
  customTemplate: string
  autoCopyAfterPublish: boolean
  imageFormat: 'original' | 'jpeg' | 'png' | 'webp'
}

export interface TaskView {
  id: string
  kind: string
  title: string
  detail: string
  status: 'queued' | 'preparing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  attempt: number
  maxAttempts: number
  canCancel: boolean
  canRetry: boolean
  createdAt: string
  error?: string | null
}

export interface AssetView {
  id: string
  name: string
  sizeBytes: number
  mimeType: string
  width?: number | null
  height?: number | null
  publicUrl: string
  status: 'online' | 'partial' | 'failed'
  createdAt: string
  deployments: Array<{
    storage: string
    providerKey: string
    role: DeploymentRole
    ok: boolean
    error?: string | null
  }>
  pluginOutputs: Array<{
    pluginId: string
    pluginName: string
    pluginKind: string
    text: string
    data: unknown
  }>
}

export interface PluginExecutionLogView {
  id: string
  pluginId: string
  pluginName: string
  hook: string
  status: 'success' | 'failed'
  durationMs: number
  message?: string | null
  createdAt: string
}

export interface PluginView {
  id: string
  name: string
  version: string
  description: string
  kind: string
  permissions: string[]
  grantedPermissions: string[]
  supportedHooks: string[]
  enabledHooks: string[]
  enabled: boolean
  installed: boolean
  source: string
  config: Record<string, unknown>
}

export interface AiSettings { baseUrl: string; model: string; apiKey: string }
export interface AiWorkflowPlan { name?: string; steps?: unknown[]; suggestedPlugins?: unknown[]; explanation?: string }

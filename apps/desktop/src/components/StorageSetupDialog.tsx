import { workflowQueryKeys } from '../features/workflows/queryKeys'
import { useEffect, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, Cloud, ExternalLink, GitBranch, GitFork, HardDrive, LoaderCircle, Server, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  copyText,
  createObjectStorage,
  createRepositoryStorage,
  createS3Storage,
  createWebDavStorage,
  getProviderGuideUrl,
  listStorages,
  openExternalUrl,
  openExternalUrlOrReport,
} from '../lib/desktop'
import type { PortableStorageProfile } from '../lib/desktop'
import { portableReconnectConflict } from '../lib/portableReconnect'
import { confirmAction, useConfirmStore } from '../store/useConfirmStore'
import { notifyError } from '../store/useToastStore'
import { R2GuidedFields } from './R2GuidedFields'
import { diagnoseR2Failure, validateR2Setup } from '../lib/r2Diagnostics'
import type {
  CreateObjectStorageInput,
  CreateRepositoryStorageInput,
  CreateS3StorageInput,
  CreateWebDavStorageInput,
  SupportedProviderKey,
  StorageView,
} from '../types'

const providerNames: Record<SupportedProviderKey, string> = {
  r2: 'Cloudflare R2',
  s3: 'S3 Compatible',
  oss: '阿里云 OSS',
  cos: '腾讯云 COS',
  github: 'GitHub',
  gitee: 'Gitee',
  webdav: 'WebDAV',
}

function defaultObjectEndpoint(provider: 'oss' | 'cos') {
  return provider === 'oss'
    ? 'https://oss-cn-hangzhou.aliyuncs.com'
    : 'https://cos.ap-guangzhou.myqcloud.com'
}

export function StorageSetupDialog({
  provider,
  onClose,
  restoreProfile,
  onCreated,
}: {
  provider: SupportedProviderKey
  onClose: () => void
  restoreProfile?: PortableStorageProfile
  onCreated?: (created: StorageView) => void
}) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLElement>(null)
  const r2ErrorRef = useRef<HTMLElement>(null)
  const guideUrl = getProviderGuideUrl(provider)
  const isRepository = provider === 'github' || provider === 'gitee'
  const isGenericS3 = provider === 'r2' || provider === 's3'
  const isObject = provider === 'oss' || provider === 'cos'
  const isWebDav = provider === 'webdav'
  const Icon = provider === 'github'
    ? GitFork
    : provider === 'gitee'
      ? GitBranch
      : provider === 'webdav'
        ? HardDrive
        : provider === 's3'
          ? Server
          : Cloud

  const [r2Step, setR2Step] = useState<0 | 1 | 2 | 3>(0)
  // An older manifest's 'unknown' access intent must never silently become public
  // just because public was the historical default in the setup form.
  const [restoreModeConfirmed, setRestoreModeConfirmed] = useState(false)
  const [tokenStatus, setTokenStatus] = useState<string | null>(null)
  // A synchronous lock covers the confirmation dialog as well as the async provider call.
  const submitGuard = useRef(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [s3Form, setS3Form] = useState<CreateS3StorageInput>({
    providerKey: provider === 's3' ? 's3' : 'r2',
    name: restoreProfile?.name ?? (provider === 's3' ? 'S3 Storage' : 'Cloudflare R2'),
    bucket: restoreProfile?.bucket ?? '',
    region: restoreProfile?.region ?? (provider === 'r2' ? 'auto' : 'us-east-1'),
    accessKeyId: '',
    secretAccessKey: '',
    publicBaseUrl: '',
    accessMode: restoreProfile?.accessMode === 'private_requested' ? 'private_requested' : 'public',
    accountId: '',
    endpoint: '',
    root: restoreProfile?.root ?? '',
  })
  const [objectForm, setObjectForm] = useState<CreateObjectStorageInput>({
    providerKey: provider === 'cos' ? 'cos' : 'oss',
    name: restoreProfile?.name ?? providerNames[provider],
    // Endpoints were intentionally excluded from export; do not infer one on import.
    endpoint: restoreProfile ? '' : defaultObjectEndpoint(provider === 'cos' ? 'cos' : 'oss'),
    bucket: restoreProfile?.bucket ?? '',
    root: restoreProfile?.root ?? '',
    publicBaseUrl: '',
    accessKeyId: '',
    secretAccessKey: '',
  })
  const [repoForm, setRepoForm] = useState<CreateRepositoryStorageInput>({
    providerKey: provider === 'gitee' ? 'gitee' : 'github',
    name: restoreProfile?.name ?? providerNames[provider],
    owner: restoreProfile?.owner ?? '',
    repo: restoreProfile?.repo ?? '',
    branch: restoreProfile?.branch ?? 'main',
    root: restoreProfile?.root ?? 'assets',
    publicBaseUrl: '',
    token: '',
  })
  const [webdavForm, setWebdavForm] = useState<CreateWebDavStorageInput>({
    name: restoreProfile?.name ?? 'WebDAV',
    endpoint: '',
    root: restoreProfile?.root ?? '',
    publicBaseUrl: '',
    username: '',
    password: '',
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (restoreProfile) {
        // Fresh duplicate check immediately before creating a *new* StorageRecord.
        // Never update, delete, adopt or silently overwrite any existing record.
        const current = await listStorages()
        const candidate: PortableStorageProfile = {
          ...restoreProfile,
          name: isRepository ? repoForm.name : isGenericS3 ? s3Form.name : isObject ? objectForm.name : webdavForm.name,
          bucket: isGenericS3 ? s3Form.bucket : isObject ? objectForm.bucket : undefined,
          owner: isRepository ? repoForm.owner : undefined,
          repo: isRepository ? repoForm.repo : undefined,
          branch: isRepository ? repoForm.branch : undefined,
        }
        if (portableReconnectConflict(candidate, current)) throw new Error('RESTORE_CONFLICT')
      }
      if (isRepository) return createRepositoryStorage({ ...repoForm, restoreGuard: Boolean(restoreProfile) })
      if (isGenericS3) return createS3Storage({ ...s3Form, restoreGuard: Boolean(restoreProfile) })
      if (isObject) return createObjectStorage({ ...objectForm, restoreGuard: Boolean(restoreProfile) })
      if (isWebDav) return createWebDavStorage({ ...webdavForm, restoreGuard: Boolean(restoreProfile) })
      throw new Error('不支持的 Provider')
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['storages'] })
      await queryClient.invalidateQueries({ queryKey: ['default-publish-target'] })
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.workflows })
      onCreated?.(created)
      onClose()
    },
    // A mutation-level handler suppresses main.tsx's global raw-error toast.
    // Without it, the R2 inline diagnosis was redacted but the global toast leaked the raw provider error.
    onError: (error) => {
      if (provider === 'r2') {
        // The focused inline diagnosis is the single error surface.
        // A second toast obscures the recovery controls on compact Windows windows.
        // Defining onError also suppresses main.tsx's global raw-error toast.
        return
      } else if (restoreProfile) {
        notifyError('重新连接失败，请核对配置及本机输入的凭据；诊断信息未包含服务商原始响应。')
      } else {
        notifyError(`操作失败：${String(error)}`)
      }
    },
  })

  const r2Issues = provider === 'r2' ? validateR2Setup({
    name: s3Form.name,
    bucket: s3Form.bucket,
    accountId: s3Form.accountId ?? '',
    region: s3Form.region ?? 'auto',
    accessMode: s3Form.accessMode ?? 'public',
    publicBaseUrl: s3Form.publicBaseUrl ?? '',
    accessKeyId: s3Form.accessKeyId,
    secretAccessKey: s3Form.secretAccessKey,
  }) : []
  const r2Failure = provider === 'r2' && mutation.error ? diagnoseR2Failure(mutation.error) : null

  const setS3 = (key: keyof CreateS3StorageInput, value: string) => {
    // Correcting a field invalidates the old diagnosis; don't keep a stale cloud failure
    // attached to an updated config that has not yet been submitted.
    if (provider === 'r2' && mutation.error) mutation.reset()
    setS3Form((current) => ({ ...current, [key]: value }))
  }
  const setObject = (key: keyof CreateObjectStorageInput, value: string) =>
    setObjectForm((current) => ({ ...current, [key]: value }))
  const setRepo = (key: keyof CreateRepositoryStorageInput, value: string) =>
    setRepoForm((current) => ({ ...current, [key]: value }))
  const setWebDav = (key: keyof CreateWebDavStorageInput, value: string) =>
    setWebdavForm((current) => ({ ...current, [key]: value }))

  // Mirrors exactly the fields the Rust create_* commands reject as empty, so the form blocks a
  // doomed submit without inventing requirements the backend does not enforce.
  const missingFields: string[] = []
  if (restoreProfile && isGenericS3 && restoreProfile.accessMode === 'unknown' && !restoreModeConfirmed) {
    missingFields.push('请明确选择公开发布或私有存储目标')
  }
  const blank = (value: string | undefined | null) => !value || !value.trim()
  const notHttp = (value: string | undefined | null) => !/^https?:\/\//i.test((value ?? '').trim())
  // Match Rust normalize_public_base_url for both first-time setup and restore.
  // This checks URL shape only, not whether the bucket/CDN is actually public.
  const invalidPublicBaseUrl = (value: string | undefined | null) => {
    try {
      const url = new URL((value ?? '').trim())
      // URL.search/hash are empty for bare '?' and '#', while Rust rejects
      // even those empty markers (query().is_some()/fragment().is_some()).
      return !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.href.includes('?') || url.href.includes('#')
    } catch {
      return true
    }
  }
  // Mirrors the backend's final gate (plugin_runtime::require_https_or_loopback):
  // plain HTTP only for localhost/127.0.0.1/[::1]; anything else must be https.
  const insecureHttp = (value: string | undefined | null) => {
    const raw = (value ?? '').trim().toLowerCase()
    if (!raw.startsWith('http://')) return false
    let host = ''
    try {
      host = new URL(raw).hostname
    } catch {
      return false
    }
    return !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
  }
  if (isRepository) {
    if (blank(repoForm.name)) missingFields.push('显示名称')
    if (blank(repoForm.owner)) missingFields.push('Owner')
    if (blank(repoForm.repo)) missingFields.push('仓库名')
    if (blank(repoForm.branch)) missingFields.push('分支')
    if (blank(repoForm.token)) missingFields.push('访问令牌')
    if (!blank(repoForm.publicBaseUrl) && invalidPublicBaseUrl(repoForm.publicBaseUrl)) {
      missingFields.push('自定义公开域名必须是 http/https URL，不能包含查询参数或片段')
    }
  } else if (isGenericS3) {
    if (provider === 'r2') {
      missingFields.push(...r2Issues.map((issue) => issue.message))
    } else {
    if (blank(s3Form.name)) missingFields.push('显示名称')
    if (blank(s3Form.bucket)) missingFields.push('Bucket')
    if (blank(s3Form.accessKeyId)) missingFields.push('Access Key ID')
    if (blank(s3Form.secretAccessKey)) missingFields.push('Secret Access Key')
    if (s3Form.providerKey === 'r2' && blank(s3Form.accountId)) missingFields.push('Account ID')
    if (s3Form.accessMode === 'private_requested' && !blank(s3Form.publicBaseUrl)) missingFields.push('私有模式必须清空公开访问域名')
    if (s3Form.accessMode !== 'private_requested') {
      if (blank(s3Form.publicBaseUrl)) missingFields.push('公开模式必须填写公开访问域名')
      else if (invalidPublicBaseUrl(s3Form.publicBaseUrl)) missingFields.push('公开访问域名必须是 http/https URL，不能包含查询参数或片段')
    }
    if (s3Form.providerKey === 's3' && (notHttp(s3Form.endpoint) || insecureHttp(s3Form.endpoint))) missingFields.push('Endpoint（需 https，或本机 http://127.0.0.1）')
    }
  } else if (isObject) {
    if (blank(objectForm.name)) missingFields.push('显示名称')
    if (blank(objectForm.bucket)) missingFields.push('Bucket')
    if (blank(objectForm.accessKeyId)) missingFields.push('Access Key ID')
    if (blank(objectForm.secretAccessKey)) missingFields.push('Secret Access Key')
    if (notHttp(objectForm.endpoint) || insecureHttp(objectForm.endpoint)) missingFields.push('Endpoint（需 https，或本机 http://127.0.0.1）')
    if (blank(objectForm.publicBaseUrl)) missingFields.push('公开访问域名')
    else if (invalidPublicBaseUrl(objectForm.publicBaseUrl)) missingFields.push('公开访问域名必须是 http/https URL，不能包含查询参数或片段')
  } else if (isWebDav) {
    if (blank(webdavForm.name)) missingFields.push('显示名称')
    if (notHttp(webdavForm.endpoint) || insecureHttp(webdavForm.endpoint)) missingFields.push('WebDAV Endpoint（需 https，或本机 http://127.0.0.1）')
    if (restoreProfile && blank(webdavForm.username)) missingFields.push('重新填写 WebDAV 用户名')
    if (restoreProfile && blank(webdavForm.password)) missingFields.push('重新填写 WebDAV 密码')
    if (blank(webdavForm.publicBaseUrl)) missingFields.push('公开访问域名')
    else if (invalidPublicBaseUrl(webdavForm.publicBaseUrl)) missingFields.push('公开访问域名必须是 http/https URL，不能包含查询参数或片段')
  }

  function requestClose() {
    // A close while the confirmation or provider call is pending can otherwise
    // leave the user thinking the operation was cancelled when it is still running.
    if (submitGuard.current || mutation.isPending) return
    onClose()
  }

  async function submitStorage() {
    if (submitGuard.current || mutation.isPending || missingFields.length > 0) return
    submitGuard.current = true
    setSubmitBusy(true)
    try {
      if (provider === 'r2') {
        const accepted = await confirmAction({
          title: '确认 R2 远端写入测试并保存',
          detail: '当前后端会向目标 Bucket 写入一个独立的临时测试对象、检查元数据，再尝试删除。如果网络中断或清理失败，可能留下临时对象。不是只读测试；请确认你对这个 Bucket 拥有操作权限。此操作不改变 Bucket 公共访问设置，也不能证明它已经私有。' + (restoreProfile ? ' 迁移模式只新增连接，不覆盖旧记录。' : ''),
          confirmLabel: '授权临时写入测试',
          danger: false,
        })
        if (!accepted) return
      } else if (restoreProfile) {
        const accepted = await confirmAction({
          title: '确认新增连接配置',
          detail: `将以“${isRepository ? repoForm.name : isGenericS3 ? s3Form.name : isObject ? objectForm.name : webdavForm.name}”新建一条 ${providerNames[provider]} 连接。将先测试新凭据；不会覆盖或关联旧资源记录、图片、工作流和现有存储。`,
          confirmLabel: '确认测试并新建',
          danger: false,
        })
        if (!accepted) return
      }
      await mutation.mutateAsync()
    } catch {
      // The mutation owns error presentation. In migration mode it redacts
      // provider errors so secrets and signed URLs are never echoed to the UI.
    } finally {
      submitGuard.current = false
      setSubmitBusy(false)
    }
  }

  useEffect(() => {
    if (provider !== 'r2') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>('input, button:not([disabled])')?.focus({ preventScroll: true })
    function handleKeyDown(event: KeyboardEvent) {
      // ConfirmDialog owns Escape and Tab while it is visible.
      if (useConfirmStore.getState().request || !dialogRef.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!submitGuard.current) onClose()
      } else if (event.key === 'Tab') {
        const enabled = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((node) => node.getClientRects().length > 0)
        if (!enabled.length) return
        const first = enabled[0], last = enabled[enabled.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
    // The dialog lifecycle owns focus; step transitions have a separate focus handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  useEffect(() => {
    if (provider !== 'r2' || !mutation.error) return
    const target = r2ErrorRef.current
    target?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    target?.focus({ preventScroll: true })
  }, [provider, mutation.error])

  useEffect(() => {
    if (provider !== 'r2') return
    const active = dialogRef.current?.querySelector<HTMLElement>(
      `[aria-current="step"], input:not([disabled])`,
    )
    active?.focus({ preventScroll: true })
  }, [provider, r2Step])

  async function openGitHubTokenPage() {
    const url = 'https://github.com/settings/personal-access-tokens/new'
    setTokenStatus('正在打开 GitHub Token 页面…')
    try {
      await openExternalUrl(url)
      setTokenStatus('已请求打开浏览器。创建 Token 后回到这里粘贴；权限请选择 Contents: Read and write。')
    } catch (error) {
      try {
        await copyText(url)
        setTokenStatus('未能自动打开浏览器，Token 创建地址已复制到剪贴板。')
      } catch {
        setTokenStatus(`无法打开 GitHub：${String(error)}`)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/25 p-3 backdrop-blur-sm sm:p-6" onMouseDown={requestClose}>
      <section ref={dialogRef} role={provider === 'r2' ? 'dialog' : undefined} aria-modal={provider === 'r2' ? true : undefined} aria-labelledby={provider === 'r2' ? 'r2-dialog-title' : undefined} onMouseDown={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-[760px] overflow-auto rounded-[24px] border border-white bg-white p-4 shadow-[0_30px_100px_rgba(15,23,42,.22)] sm:rounded-[28px] sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 place-items-center rounded-2xl bg-slate-100"><Icon size={19} /></div>
          <div>
            <h2 id={provider === 'r2' ? 'r2-dialog-title' : undefined} className="text-lg font-semibold">连接 {providerNames[provider]}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {isRepository
                ? '仓库、分支与 Token 即可开始。公开仓库默认生成 Raw URL。'
                : isWebDav
                  ? '填写 WebDAV 地址与账号，并指定一个可公开访问的基础 URL。'
                  : '先填平台控制台能直接找到的字段；Endpoint 已提供常用默认值。'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {guideUrl ? (
              <button type="button" onClick={() => openExternalUrlOrReport(guideUrl)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
                <BookOpen size={14} /> 配置教程 <ExternalLink size={11} />
              </button>
            ) : <span data-guide-unavailable className="text-[11px] text-slate-400">在线教程地址未配置</span>}
            <button onClick={requestClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="关闭"><X size={18} /></button>
          </div>
        </div>

        {restoreProfile && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
            <strong>迁移重连模式：</strong>已预填清单中的非敏感字段，云端 Endpoint、公开域名、账户 ID 与所有凭据必须重新确认。
            测试成功后只会<strong>新增一条连接</strong>，不会覆盖同名存储，也不会恢复图片索引或工作流。
          </div>
        )}

        {isRepository && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="显示名称" value={repoForm.name} onChange={(value) => setRepo('name', value)} />
            <Field label="用户名 / Owner" value={repoForm.owner} onChange={(value) => setRepo('owner', value)} placeholder="username" />
            <Field label="仓库名" value={repoForm.repo} onChange={(value) => setRepo('repo', value)} placeholder="images" />
            <Field label="分支" value={repoForm.branch} onChange={(value) => setRepo('branch', value)} placeholder="main" />
            <Field label="资源目录" value={repoForm.root || ''} onChange={(value) => setRepo('root', value)} placeholder="assets" />
            <div>
              <Field label="访问令牌" type="password" value={repoForm.token} onChange={(value) => setRepo('token', value)} placeholder={provider === 'github' ? 'github_pat_... / ghp_...' : 'Access Token'} />
              {provider === 'github' && (
                <div className="mt-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5 text-slate-400">
                    <span>Personal Access Token，不是 SSH 密钥、SSH 指纹或 GitHub 密码。</span>
                    <button type="button" onClick={() => void openGitHubTokenPage()} className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-950">
                      创建 Token <ExternalLink size={11} />
                    </button>
                  </div>
                  {tokenStatus && (
                    <div className={`mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px] leading-5 ${tokenStatus.startsWith('无法') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      <CheckCircle2 size={12} className="mt-1 shrink-0" />{tokenStatus}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="自定义公开域名（可选）" value={repoForm.publicBaseUrl || ''} onChange={(value) => setRepo('publicBaseUrl', value)} placeholder="https://img.example.com" />
              <p className="mt-1.5 text-[11px] leading-5 text-slate-400">公开仓库可留空并使用 Raw 地址；私有仓库若要给别人访问，请填写公开代理/CDN 地址。</p>
            </div>
          </div>
        )}

        {provider === 'r2' && (
          <R2GuidedFields
            form={s3Form} setField={setS3} issues={r2Issues} step={r2Step} setStep={setR2Step}
            restoreChoicePending={Boolean(restoreProfile?.accessMode === 'unknown' && !restoreModeConfirmed)}
            confirmMode={(accessMode) => { if (mutation.error) mutation.reset(); setRestoreModeConfirmed(true); setS3Form((current) => ({ ...current, accessMode, publicBaseUrl: accessMode === 'private_requested' ? '' : current.publicBaseUrl })) }}
          />
        )}
        {isGenericS3 && provider !== 'r2' && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="显示名称" value={s3Form.name} onChange={(value) => setS3('name', value)} />
            <Field label="Bucket" value={s3Form.bucket} onChange={(value) => setS3('bucket', value)} placeholder="images" />
            <Field label="Endpoint" value={s3Form.endpoint || ''} onChange={(value) => setS3('endpoint', value)} placeholder="https://s3.example.com" />
            <Field label="Region" value={s3Form.region || ''} onChange={(value) => setS3('region', value)} placeholder="us-east-1" />
            <Field label="Access Key ID" value={s3Form.accessKeyId} onChange={(value) => setS3('accessKeyId', value)} />
            <Field label="Secret Access Key" type="password" value={s3Form.secretAccessKey} onChange={(value) => setS3('secretAccessKey', value)} />
            <Field label="资源目录（可选）" value={s3Form.root || ''} onChange={(value) => setS3('root', value)} placeholder="assets" />
            {isGenericS3 && (
              <div className="sm:col-span-2">
                <div className="mb-2 text-xs font-medium text-slate-600">此 S3 存储的发布用途</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setRestoreModeConfirmed(true); setS3Form((current) => ({ ...current, accessMode: 'public' })) }} aria-pressed={s3Form.accessMode !== 'private_requested'} className={`rounded-xl border px-3 py-2.5 text-xs ${s3Form.accessMode !== 'private_requested' ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-600'}`}>公开发布</button>
                  <button type="button" onClick={() => { setRestoreModeConfirmed(true); setS3Form((current) => ({ ...current, accessMode: 'private_requested', publicBaseUrl: '' })) }} aria-pressed={s3Form.accessMode === 'private_requested'} className={`rounded-xl border px-3 py-2.5 text-xs ${s3Form.accessMode === 'private_requested' ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-600'}`}>私有存储目标</button>
                </div>
                {s3Form.accessMode === 'private_requested' && <p className="mt-2 text-xs leading-5 text-amber-700">仅请求以不生成公开 URL 的方式上传；镜云不会修改服务商的 Bucket ACL、公开域名或 CDN。请在云服务控制台关闭所有公开入口，并在最终验收时验证匿名读取被拒绝。S3 兼容签名实现可能不同；生成的临时链接属于持有者可访问的敏感凭据。</p>}
              </div>
            )}
            {s3Form.accessMode !== 'private_requested' && (
              <div className="sm:col-span-2">
                <Field label="公开访问域名（发布到该云端时必填）" value={s3Form.publicBaseUrl || ''} onChange={(value) => setS3('publicBaseUrl', value)} placeholder="https://img.example.com" />
                <p className="mt-1.5 text-[11px] text-slate-400">用于生成别人可以直接打开的 URL。</p>
              </div>
            )}
          </div>
        )}

        {isObject && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="显示名称" value={objectForm.name} onChange={(value) => setObject('name', value)} />
            <Field label="Bucket" value={objectForm.bucket} onChange={(value) => setObject('bucket', value)} placeholder="images" />
            <div className="sm:col-span-2"><Field label="Endpoint" value={objectForm.endpoint} onChange={(value) => setObject('endpoint', value)} placeholder={defaultObjectEndpoint(provider === 'cos' ? 'cos' : 'oss')} /></div>
            <Field label={provider === 'cos' ? 'SecretId' : 'AccessKey ID'} value={objectForm.accessKeyId} onChange={(value) => setObject('accessKeyId', value)} />
            <Field label={provider === 'cos' ? 'SecretKey' : 'AccessKey Secret'} type="password" value={objectForm.secretAccessKey} onChange={(value) => setObject('secretAccessKey', value)} />
            <Field label="资源目录（可选）" value={objectForm.root || ''} onChange={(value) => setObject('root', value)} placeholder="assets" />
            <div className="sm:col-span-2">
              <Field label="公开访问域名（发布到该云端时必填）" value={objectForm.publicBaseUrl || ''} onChange={(value) => setObject('publicBaseUrl', value)} placeholder="https://img.example.com" />
              <p className="mt-1.5 text-[11px] text-slate-400">建议使用已绑定的 CDN / 自定义域名；不要填写控制台地址。</p>
            </div>
          </div>
        )}

        {isWebDav && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="显示名称" value={webdavForm.name} onChange={(value) => setWebDav('name', value)} />
            <Field label="资源目录（可选）" value={webdavForm.root || ''} onChange={(value) => setWebDav('root', value)} placeholder="images" />
            <div className="sm:col-span-2"><Field label="WebDAV Endpoint" value={webdavForm.endpoint} onChange={(value) => setWebDav('endpoint', value)} placeholder="https://dav.example.com/remote.php/dav/files/user" /></div>
            <Field label="用户名" value={webdavForm.username} onChange={(value) => setWebDav('username', value)} />
            <Field label="密码 / App Password" type="password" value={webdavForm.password} onChange={(value) => setWebDav('password', value)} />
            <div className="sm:col-span-2">
              <Field label="公开访问域名（发布到该云端时必填）" value={webdavForm.publicBaseUrl || ''} onChange={(value) => setWebDav('publicBaseUrl', value)} placeholder="https://files.example.com/public" />
              <p className="mt-1.5 text-[11px] text-slate-400">WebDAV 本身不等于公网图床；这里必须填写别人能直接访问资源的公开 URL 前缀。</p>
            </div>
          </div>
        )}

        {r2Failure && (
          <section ref={r2ErrorRef} tabIndex={-1} aria-label="R2 连接诊断" role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-6 text-red-800">
            <h3 className="font-semibold">{r2Failure.title}</h3>
            <p className="mt-1">以下是排查方向，尚未证实根因。原始错误可能包含敏感信息，不在此显示。</p>
            <ul className="mt-2 list-inside list-disc">{r2Failure.checks.map((check) => <li key={check}>{check}</li>)}</ul>
            <button type="button" className="mt-3 min-h-11 rounded-lg border border-red-200 bg-white px-3 text-red-900"
              onClick={() => setR2Step(r2Failure.kind === 'bucket' || r2Failure.kind === 'endpoint' ? 0 : 2)}>返回相关配置步骤</button>
          </section>
        )}
        {mutation.error && !r2Failure && <div role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-600">{restoreProfile ? (String(mutation.error).includes('RESTORE_CONFLICT') ? '发现同名连接或相同目标。请先到存储管理核对；不会重复创建或覆盖。' : '重新连接失败，请核对 Endpoint、公开访问方式及本机输入的凭据。') : String(mutation.error).replace(/^Error:\s*/i, '')}</div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {missingFields.length > 0 && (provider !== 'r2' || r2Step === 3) ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">还需填写：{missingFields.join('、')}</div>
          ) : <span />}
          <div className="flex gap-2">
            <button disabled={submitBusy || mutation.isPending} onClick={requestClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm disabled:opacity-50">取消</button>
            {provider === 'r2' && r2Step > 0 && <button type="button" disabled={submitBusy || mutation.isPending} onClick={() => setR2Step((r2Step - 1) as 0 | 1 | 2 | 3)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm">上一步</button>}
            {(provider !== 'r2' || r2Step === 3) && <button disabled={submitBusy || mutation.isPending || missingFields.length > 0} onClick={() => void submitStorage()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {mutation.isPending && <LoaderCircle size={15} className="animate-spin" />}
              {provider === 'r2' ? '授权测试并保存' : restoreProfile ? '测试并新增连接' : '测试并保存'}
            </button>}
          </div>
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-slate-400"
      />
    </label>
  )
}

import { useState } from 'react'
import { BookOpen, CheckCircle2, Cloud, ExternalLink, GitBranch, GitFork, HardDrive, LoaderCircle, Server, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  copyText,
  createObjectStorage,
  createRepositoryStorage,
  createS3Storage,
  createWebDavStorage,
  getProviderGuideUrl,
  openExternalUrl,
} from '../lib/desktop'
import type {
  CreateObjectStorageInput,
  CreateRepositoryStorageInput,
  CreateS3StorageInput,
  CreateWebDavStorageInput,
  SupportedProviderKey,
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

const providerGuideSteps: Record<SupportedProviderKey, string[]> = {
  github: [
    '准备一个用于图片托管的 GitHub 仓库，并确认目标分支（通常是 main）。',
    '创建 Fine-grained Personal Access Token，只授权目标仓库，并授予 Contents: Read and write。',
    '填写 Owner、仓库名、分支和资源目录。资源目录默认 assets，不需要提前创建，第一次上传后会自动出现。',
    '公开仓库可以把“自定义公开域名”留空，应用会生成 Raw URL；私有仓库需要额外的公开代理/CDN。',
    '点击“测试并保存”。保存后先到“图库”刷新一次，确认可以直接浏览远端真实文件，再上传第一张图片。',
  ],
  gitee: [
    '准备一个用于图片托管的 Gitee 仓库，并确认目标分支。',
    '在 Gitee 创建具备仓库读写权限的 Access Token。',
    '填写 Owner、仓库名、分支、资源目录和 Token。',
    '若图片要公开访问，请确认仓库或自定义公开地址可以被外部访问。',
    '点击“测试并保存”，随后到“图库”验证远端文件浏览。',
  ],
  r2: [
    '在 Cloudflare R2 创建 Bucket，并记下 Account ID。',
    '创建 R2 API Token / Access Key，获得 Access Key ID 与 Secret Access Key。',
    'Region 保持 auto；填写 Bucket、Account ID 和密钥。',
    '填写公开访问域名：它决定图片的公网链接。留空时该云端只能作为镜像 / 备份成员；作为发布目标时发布会失败并回滚。',
    '点击“测试并保存”，再上传一张测试图片验证。',
  ],
  s3: [
    '准备兼容 S3 的 Bucket、Endpoint 和 Region。',
    '创建具备对象读写权限的 Access Key ID / Secret Access Key。',
    '填写 Endpoint、Region、Bucket 和密钥；资源目录可选。',
    '填写真正能让别人访问图片的公开 URL 前缀；应用不会从 Endpoint 推导图片地址，留空时该云端只能作为镜像 / 备份成员。',
    '点击“测试并保存”，再到图库验证浏览。',
  ],
  oss: [
    '在阿里云 OSS 创建 Bucket，并确认区域对应的 Endpoint。',
    '创建具备该 Bucket 读写权限的 AccessKey ID / AccessKey Secret。',
    '填写 Bucket、Endpoint、密钥和可选资源目录。',
    '填写公开访问域名；应用不会从 Endpoint 推导图片地址。留空时该云端只能作为镜像 / 备份成员，作为发布目标会失败并回滚。',
    '点击“测试并保存”，再上传测试图片。',
  ],
  cos: [
    '在腾讯云 COS 创建 Bucket，并确认区域对应的 Endpoint。',
    '创建具备该 Bucket 读写权限的 SecretId / SecretKey。',
    '填写 Bucket、Endpoint、密钥和可选资源目录。',
    '填写公开访问域名；应用不会从 Endpoint 推导图片地址。留空时该云端只能作为镜像 / 备份成员，作为发布目标会失败并回滚。',
    '点击“测试并保存”，再上传测试图片。',
  ],
  webdav: [
    '准备 WebDAV Endpoint、用户名与密码 / App Password。',
    '确认账号对目标目录具备读取、写入和删除权限。',
    '填写可选资源目录。',
    'WebDAV 地址通常不是公网图片地址，因此要填写别人可以直接访问文件的公开 URL 前缀；留空时该云端只能作为镜像 / 备份成员。',
    '点击“测试并保存”，再到图库验证远端浏览。',
  ],
}

function defaultObjectEndpoint(provider: 'oss' | 'cos') {
  return provider === 'oss'
    ? 'https://oss-cn-hangzhou.aliyuncs.com'
    : 'https://cos.ap-guangzhou.myqcloud.com'
}

export function StorageSetupDialog({
  provider,
  onClose,
}: {
  provider: SupportedProviderKey
  onClose: () => void
}) {
  const queryClient = useQueryClient()
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

  const [showGuide, setShowGuide] = useState(false)
  const [tokenStatus, setTokenStatus] = useState<string | null>(null)
  const [s3Form, setS3Form] = useState<CreateS3StorageInput>({
    providerKey: provider === 's3' ? 's3' : 'r2',
    name: provider === 's3' ? 'S3 Storage' : 'Cloudflare R2',
    bucket: '',
    region: provider === 'r2' ? 'auto' : 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    publicBaseUrl: '',
    accountId: '',
    endpoint: '',
    root: '',
  })
  const [objectForm, setObjectForm] = useState<CreateObjectStorageInput>({
    providerKey: provider === 'cos' ? 'cos' : 'oss',
    name: providerNames[provider],
    endpoint: defaultObjectEndpoint(provider === 'cos' ? 'cos' : 'oss'),
    bucket: '',
    root: '',
    publicBaseUrl: '',
    accessKeyId: '',
    secretAccessKey: '',
  })
  const [repoForm, setRepoForm] = useState<CreateRepositoryStorageInput>({
    providerKey: provider === 'gitee' ? 'gitee' : 'github',
    name: providerNames[provider],
    owner: '',
    repo: '',
    branch: 'main',
    root: 'assets',
    publicBaseUrl: '',
    token: '',
  })
  const [webdavForm, setWebdavForm] = useState<CreateWebDavStorageInput>({
    name: 'WebDAV',
    endpoint: '',
    root: '',
    publicBaseUrl: '',
    username: '',
    password: '',
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (isRepository) return createRepositoryStorage(repoForm)
      if (isGenericS3) return createS3Storage(s3Form)
      if (isObject) return createObjectStorage(objectForm)
      if (isWebDav) return createWebDavStorage(webdavForm)
      throw new Error('不支持的 Provider')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['storages'] })
      await queryClient.invalidateQueries({ queryKey: ['default-publish-target'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onClose()
    },
  })

  const setS3 = (key: keyof CreateS3StorageInput, value: string) =>
    setS3Form((current) => ({ ...current, [key]: value }))
  const setObject = (key: keyof CreateObjectStorageInput, value: string) =>
    setObjectForm((current) => ({ ...current, [key]: value }))
  const setRepo = (key: keyof CreateRepositoryStorageInput, value: string) =>
    setRepoForm((current) => ({ ...current, [key]: value }))
  const setWebDav = (key: keyof CreateWebDavStorageInput, value: string) =>
    setWebdavForm((current) => ({ ...current, [key]: value }))

  // Mirrors exactly the fields the Rust create_* commands reject as empty, so the form blocks a
  // doomed submit without inventing requirements the backend does not enforce.
  const missingFields: string[] = []
  const blank = (value: string | undefined | null) => !value || !value.trim()
  const notHttp = (value: string | undefined | null) => !/^https?:\/\//i.test((value ?? '').trim())
  if (isRepository) {
    if (blank(repoForm.name)) missingFields.push('显示名称')
    if (blank(repoForm.owner)) missingFields.push('Owner')
    if (blank(repoForm.repo)) missingFields.push('仓库名')
    if (blank(repoForm.branch)) missingFields.push('分支')
    if (blank(repoForm.token)) missingFields.push('访问令牌')
  } else if (isGenericS3) {
    if (blank(s3Form.name)) missingFields.push('显示名称')
    if (blank(s3Form.bucket)) missingFields.push('Bucket')
    if (blank(s3Form.accessKeyId)) missingFields.push('Access Key ID')
    if (blank(s3Form.secretAccessKey)) missingFields.push('Secret Access Key')
    if (s3Form.providerKey === 'r2' && blank(s3Form.accountId)) missingFields.push('Account ID')
    if (s3Form.providerKey === 's3' && notHttp(s3Form.endpoint)) missingFields.push('Endpoint（需 http/https 开头）')
  } else if (isObject) {
    if (blank(objectForm.name)) missingFields.push('显示名称')
    if (blank(objectForm.bucket)) missingFields.push('Bucket')
    if (blank(objectForm.accessKeyId)) missingFields.push('Access Key ID')
    if (blank(objectForm.secretAccessKey)) missingFields.push('Secret Access Key')
    if (notHttp(objectForm.endpoint)) missingFields.push('Endpoint（需 http/https 开头）')
  } else if (isWebDav) {
    if (blank(webdavForm.name)) missingFields.push('显示名称')
    if (notHttp(webdavForm.endpoint)) missingFields.push('WebDAV Endpoint（需 http/https 开头）')
  }

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
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/25 p-3 backdrop-blur-sm sm:p-6" onMouseDown={onClose}>
      <section onMouseDown={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-[760px] overflow-auto rounded-[24px] border border-white bg-white p-4 shadow-[0_30px_100px_rgba(15,23,42,.22)] sm:rounded-[28px] sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 place-items-center rounded-2xl bg-slate-100"><Icon size={19} /></div>
          <div>
            <h2 className="text-lg font-semibold">连接 {providerNames[provider]}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {isRepository
                ? '仓库、分支与 Token 即可开始。公开仓库默认生成 Raw URL。'
                : isWebDav
                  ? '填写 WebDAV 地址与账号，并指定一个可公开访问的基础 URL。'
                  : '先填平台控制台能直接找到的字段；Endpoint 已提供常用默认值。'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setShowGuide((value) => !value)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
              <BookOpen size={14} /> {showGuide ? '收起教程' : '配置教程'}
            </button>
            <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="关闭"><X size={18} /></button>
          </div>
        </div>

        {showGuide && (
          <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-indigo-950">{providerNames[provider]} 配置教程</div>
                <div className="mt-1 text-[11px] leading-5 text-indigo-700/70">教程内置在应用里，不依赖文档网站。按顺序完成即可。</div>
              </div>
              {guideUrl && (
                <button type="button" onClick={() => void openExternalUrl(guideUrl)} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-indigo-700">
                  在线文档 <ExternalLink size={11} />
                </button>
              )}
            </div>
            <div className="mt-4 space-y-2">
              {providerGuideSteps[provider].map((step, index) => (
                <div key={step} className="flex gap-3 rounded-xl bg-white/80 p-3">
                  <div className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">{index + 1}</div>
                  <div className="text-xs leading-6 text-slate-600">{step}</div>
                </div>
              ))}
            </div>
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

        {isGenericS3 && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="显示名称" value={s3Form.name} onChange={(value) => setS3('name', value)} />
            <Field label="Bucket" value={s3Form.bucket} onChange={(value) => setS3('bucket', value)} placeholder="images" />
            {provider === 'r2'
              ? <Field label="Account ID" value={s3Form.accountId || ''} onChange={(value) => setS3('accountId', value)} placeholder="Cloudflare Account ID" />
              : <Field label="Endpoint" value={s3Form.endpoint || ''} onChange={(value) => setS3('endpoint', value)} placeholder="https://s3.example.com" />}
            <Field label="Region" value={s3Form.region || ''} onChange={(value) => setS3('region', value)} placeholder={provider === 'r2' ? 'auto' : 'us-east-1'} />
            <Field label="Access Key ID" value={s3Form.accessKeyId} onChange={(value) => setS3('accessKeyId', value)} />
            <Field label="Secret Access Key" type="password" value={s3Form.secretAccessKey} onChange={(value) => setS3('secretAccessKey', value)} />
            <Field label="资源目录（可选）" value={s3Form.root || ''} onChange={(value) => setS3('root', value)} placeholder="assets" />
            <div className="sm:col-span-2">
              <Field label="公开访问域名（发布到该云端时必填）" value={s3Form.publicBaseUrl || ''} onChange={(value) => setS3('publicBaseUrl', value)} placeholder="https://img.example.com" />
              <p className="mt-1.5 text-[11px] text-slate-400">用于生成别人可以直接打开的 URL。</p>
            </div>
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

        {mutation.error && <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-600">{String(mutation.error).replace(/^Error:\s*/i, '')}</div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {missingFields.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">还需填写：{missingFields.join('、')}</div>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm">取消</button>
            <button disabled={mutation.isPending || missingFields.length > 0} onClick={() => mutation.mutate()} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {mutation.isPending && <LoaderCircle size={15} className="animate-spin" />}
              测试并保存
            </button>
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

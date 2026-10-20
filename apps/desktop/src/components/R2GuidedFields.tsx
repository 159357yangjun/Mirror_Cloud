import type { CreateS3StorageInput } from '../types'
import type { R2SetupIssue } from '../lib/r2Diagnostics'
import { r2EndpointPreview } from '../lib/r2Diagnostics'

const STEPS = ['存储桶', '发布用途', 'API 密钥', '检查与保存'] as const

export function R2GuidedFields({
  form, setField, issues, step, setStep, restoreChoicePending, confirmMode,
}: {
  form: CreateS3StorageInput
  setField: (key: keyof CreateS3StorageInput, value: string) => void
  issues: R2SetupIssue[]
  step: 0 | 1 | 2 | 3
  setStep: (step: 0 | 1 | 2 | 3) => void
  restoreChoicePending: boolean
  confirmMode: (accessMode: 'public' | 'private_requested') => void
}) {
  const stageIssues = issues.filter((i) => i.step === step)
  const endpoint = r2EndpointPreview(form.accountId ?? '')
  return (
    <div className="mt-5 space-y-4">
      <nav aria-label="R2 配置步骤" className="grid grid-cols-4 gap-2">
        {STEPS.map((name, index) => (
          <button
            key={name}
            type="button"
            onClick={() => { if (index < step) setStep(index as 0 | 1 | 2 | 3) }}
            disabled={index > step}
            aria-current={index === step ? 'step' : undefined}
            className={`min-h-11 rounded-xl border px-2 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${index === step ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-900' : 'border-slate-200 text-slate-600 disabled:opacity-50'}`}
          >
            {index + 1}. {name}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <R2Field label="连接名称" field="name" value={form.name} onChange={(v) => setField('name', v)} issues={issues} />
          <R2Field label="Bucket（存储桶名）" field="bucket" value={form.bucket} onChange={(v) => setField('bucket', v)} placeholder="my-images" issues={issues}
            help="到 Cloudflare → R2 → Buckets 复制桶名，不要填写图片目录或公开域名。" />
          <div className="sm:col-span-2">
            <R2Field label="Account ID" field="accountId" value={form.accountId ?? ''} onChange={(v) => setField('accountId', v)} issues={issues}
              placeholder="32 位十六进制 ID" help="在 Cloudflare R2 控制台查看 Account ID，不是用户邮箱，也不是 API Token。" />
          </div>
          <div className="sm:col-span-2 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-700">
            <div className="font-medium">API Endpoint：由 Account ID 自动生成</div>
            <div className="mt-1 break-all font-mono">{endpoint ?? '填写合法 Account ID 后自动预览'}</div>
            <div className="mt-1">Region 固定为 <strong>auto</strong>。目前镜云后端只连接默认辖区；EU / US / FedRAMP 专用辖区暂不支持，不能通过手动更改 Region 绕过。</div>
            {form.region?.toLowerCase() !== 'auto' && (
              <button type="button" onClick={() => setField('region', 'auto')} className="mt-2 min-h-11 rounded-lg bg-white px-3 text-indigo-700 ring-1 ring-indigo-200">恢复 Region 为 auto</button>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="text-sm font-medium">你要把这条连接用于什么？</div>
          {restoreChoicePending && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">旧清单未确认公开/私有意图，必须重新明确选择后才能继续。</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" aria-pressed={form.accessMode === 'public' && !restoreChoicePending} onClick={() => confirmMode('public')}
              className={`min-h-14 rounded-xl border p-3 text-left text-sm ${form.accessMode === 'public' && !restoreChoicePending ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}>
              <strong className="block">公开发布</strong><span className="text-xs text-slate-600">需要另外配置真正允许公开访问的域名。</span>
            </button>
            <button type="button" aria-pressed={form.accessMode === 'private_requested' && !restoreChoicePending} onClick={() => confirmMode('private_requested')}
              className={`min-h-14 rounded-xl border p-3 text-left text-sm ${form.accessMode === 'private_requested' && !restoreChoicePending ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}>
              <strong className="block">私有存储目标</strong><span className="text-xs text-slate-600">不生成公开 URL；不会自动关闭 R2 公网入口。</span>
            </button>
          </div>
          {form.accessMode === 'public' ? (
            <R2Field label="公开访问地址" field="publicBaseUrl" value={form.publicBaseUrl ?? ''} onChange={(v) => setField('publicBaseUrl', v)}
              placeholder="https://img.example.com" issues={issues} help="应填写已启用的公开域名或 R2 公共开发域名，而不是 S3 API Endpoint。"/>
          ) : <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800">私有模式只是镜云的访问意图：请在 Cloudflare 控制台关闭所有公开入口，并另行验收匿名读取被拒绝。连接成功不等于已验证私有。</p>}
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-xl bg-slate-50 p-3 text-xs leading-6">
            在 Cloudflare R2 → Manage API Tokens 创建限定到目标 Bucket 的 <strong>Object Read & Write</strong> 凭据。
            请填写由 R2 生成的 Access Key ID 与 Secret Access Key，不要粘贴普通 Cloudflare API Token，也不要将密钥放入截图或报错日志。
          </div>
          <R2Field label="Access Key ID" field="accessKeyId" value={form.accessKeyId} onChange={(v) => setField('accessKeyId', v)} type="password" issues={issues}/>
          <R2Field label="Secret Access Key" field="secretAccessKey" value={form.secretAccessKey} onChange={(v) => setField('secretAccessKey', v)} type="password" issues={issues}/>
          <label className="sm:col-span-2 block text-xs text-slate-700">资源目录（可选）
            <input value={form.root ?? ''} onChange={(event) => setField('root', event.target.value)} placeholder="assets"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"/>
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-7">
          <h3 className="mb-2 text-sm font-semibold">提交前安全复核</h3>
          <div>存储桶：<strong>{form.bucket}</strong></div>
          <div>Endpoint：<span className="break-all font-mono">{endpoint ?? '未生成'}</span></div>
          <div>用途：{form.accessMode === 'private_requested' ? '私有访问意图（未验匿名权限）' : '公开访问（未验实际可访问）'}</div>
          <div>凭据：{form.accessKeyId.trim() && form.secretAccessKey.trim() ? '已填写（不展示内容）' : '尚未填写完整'}</div>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900">保存时现有后端会在目标桶写入临时测试对象，检查其元数据，再尝试删除。删除失败可能遗留临时对象。必须在确认弹窗中授权；这里的摘要检查完全离线，不做写入。</p>
          {issues.length > 0 && <p role="alert" className="mt-2 text-red-700">还有 {issues.length} 项配置需要修正。请回到相应步骤。</p>}
        </div>
      )}

      {stageIssues.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800">
          {stageIssues.map((issue) => <p key={issue.field}>{issue.message}</p>)}
        </div>
      )}
      {step < 3 && (
        <div className="flex justify-end">
          <button type="button" disabled={stageIssues.length > 0 || (step === 1 && restoreChoicePending)}
            onClick={() => setStep((step + 1) as 0 | 1 | 2 | 3)}
            className="min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
            继续：{STEPS[step + 1]} →
          </button>
        </div>
      )}
    </div>
  )
}

function R2Field({
  field, label, value, onChange, issues, placeholder, help, type = 'text',
}: {
  field: R2SetupIssue['field']
  label: string
  value: string
  onChange: (v: string) => void
  issues: R2SetupIssue[]
  placeholder?: string
  help?: string
  type?: string
}) {
  const error = issues.find((issue) => issue.field === field)
  const hintId = `r2-help-${field}`
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        aria-invalid={Boolean(error)} aria-describedby={hintId} autoComplete="off"
        className={`mt-2 min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-indigo-400 ${error ? 'border-red-400' : 'border-slate-200'}`}/>
      <span id={hintId} className={`mt-1 block text-xs font-normal leading-5 ${error ? 'text-red-700' : 'text-slate-500'}`}>{error?.message ?? help ?? ''}</span>
    </label>
  )
}

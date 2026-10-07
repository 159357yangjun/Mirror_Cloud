import { Cloud, GitBranch, GitFork, HardDrive, Server, X } from 'lucide-react'
import type { SupportedProviderKey } from '../types'

const providers: Array<{
  id: SupportedProviderKey
  name: string
  detail: string
  badge: string
  setupMinutes: number
  icon: typeof Cloud
}> = [
  { id: 'r2', name: 'Cloudflare R2', detail: '低成本对象存储，适合博客与公开图片', badge: '推荐', setupMinutes: 5, icon: Cloud },
  { id: 'oss', name: '阿里云 OSS', detail: '国内主流对象存储，适合网站与静态资源', badge: '国内', setupMinutes: 8, icon: Cloud },
  { id: 'cos', name: '腾讯云 COS', detail: '国内主流对象存储，适合网站与静态资源', badge: '国内', setupMinutes: 8, icon: Cloud },
  { id: 's3', name: 'S3 Compatible', detail: 'AWS、MinIO 与其他 S3 兼容服务', badge: '通用', setupMinutes: 6, icon: Server },
  { id: 'github', name: 'GitHub', detail: 'README、项目文档与少量仓库资源', badge: '开发者', setupMinutes: 3, icon: GitFork },
  { id: 'gitee', name: 'Gitee', detail: '国内仓库资源与镜像备份', badge: '开发者', setupMinutes: 3, icon: GitBranch },
  { id: 'webdav', name: 'WebDAV', detail: 'NAS、自建服务与通用文件服务器', badge: '自建', setupMinutes: 5, icon: HardDrive },
]

export function ProviderPickerDialog({
  onPick,
  onClose,
}: {
  onPick: (provider: SupportedProviderKey) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/25 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        className="w-full max-w-[760px] rounded-[28px] border border-white bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">添加云端存储</h2>
            <p className="mt-1 text-xs text-slate-400">只保留常用 Provider；每个平台只展示首次连接真正需要的字段。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {providers.map(({ id, name, detail, badge, setupMinutes, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onPick(id)}
              className="group rounded-[20px] border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-2xl bg-slate-100 transition group-hover:bg-slate-950 group-hover:text-white">
                  <Icon size={18} />
                </div>
                <div className="text-sm font-medium">{name}</div>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">{badge}</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">{detail}</p>
              <div className="mt-2 text-[10px] text-slate-400">首次配置约 {setupMinutes} 分钟</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

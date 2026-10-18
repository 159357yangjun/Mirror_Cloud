import { BookOpen, Boxes, Cloud, Copy, ExternalLink, Images, Settings2, Upload, Workflow, X } from 'lucide-react'
import type { PageKey } from '../types'

type GuideTint = 'info' | 'accent' | 'success' | 'warning'

const TINT: Record<GuideTint, { ink: string; bed: string }> = {
  info: { ink: 'var(--info)', bed: 'var(--info-soft)' },
  accent: { ink: 'var(--accent)', bed: 'var(--accent-soft)' },
  success: { ink: 'var(--tutorial-success-text)', bed: 'var(--success-soft)' },
  warning: { ink: 'var(--tutorial-warning-text)', bed: 'var(--warning-soft)' },
}

// The Latin/CJK pair this box really resolves to on the target machine. Inter is named in the app
// stylesheet but is neither bundled nor installed, so naming it here would repeat the mistake;
// "Microsoft YaHei" is listed because the app-wide stack has no CJK face at all and Chinese glyphs
// currently fall to whatever the WebView picks.
const DIALOG_FONT = '"Segoe UI", "Segoe UI Variable Text", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'

export function HelpCenterDialog({
  onClose,
  onNavigate,
  onlineDocsUrl,
  openExternalUrl,
}: {
  onClose: () => void
  onNavigate: (page: PageKey) => void
  onlineDocsUrl?: string | null
  openExternalUrl: (url: string) => void
}) {
  function go(page: PageKey) {
    onNavigate(page)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section
        onMouseDown={(event) => event.stopPropagation()}
        style={{ fontFamily: DIALOG_FONT }}
        className="theme-surface flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[24px] border shadow-[0_35px_120px_rgba(15,23,42,.28)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><BookOpen size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">新手教程 · 镜云</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">先连接一个云端，上传测试图片，再核对任务与访问结果。Typora、插件和多云备份可以以后再设置；这份教程离线也能查看。</p>
          </div>
          {onlineDocsUrl && <button onClick={() => openExternalUrl(onlineDocsUrl)} className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px]! font-medium! text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><ExternalLink size={13} className="mr-1 inline" />在线文档</button>}
          <button onClick={onClose} className="shrink-0 rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]" aria-label="关闭教程"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <GuideCard tint="info" icon={Cloud} step="1" title="连接一个云端存储" description="首次可从 GitHub 开始：填写仓库信息和访问令牌，先测试连接再保存。连接成功不等于公开地址可用或私有权限已验证。" action="去云端" onClick={() => go('storages')} />
            <GuideCard tint="info" icon={Cloud} step="R2" title="R2 逐步配置与排错" description="在云端选择 Cloudflare R2，依次核对桶名、Account ID、公开/私有用途和密钥。遇到连接错误可查看不泄漏密钥的对应修复建议；仅最后的远端测试会请求写入授权。" action="打开 R2 配置入口" onClick={() => go('storages')} />
            <GuideCard tint="accent" icon={Upload} step="2" title="上传第一张测试图片" description="点击“快速发布”选择图片，确认默认云端后提交。任务成功代表本次上传已完成；请再核对资源记录、访问链接或私有权限。" action="开始发布" onClick={() => go('publish')} />
            <GuideCard tint="info" icon={Images} step="3" title="在“图库”查看云端文件" description="图库浏览已连接云端的文件，也能查看非镜云上传的旧图片；它与记录本机发布结果的“资源”页不同。" action="打开图库" onClick={() => go('gallery')} />
            <GuideCard tint="success" icon={Boxes} step="4" title="理解“资源”记录" description="“资源”记录图片名称、可用地址、部署和插件结果，图片本体仍在云端。连接已有云端不会自动把旧文件加入发布记录。" action="查看资源" onClick={() => go('assets')} />
            <GuideCard tint="success" icon={Copy} step="5" title="复制链接与私有分享" description="有公开地址时，可以复制 URL、Markdown 或 HTML 等格式。私有图片不应直接公开：请到“资源”按权限生成限时分享链接。" action="查看设置" onClick={() => go('settings')} />
            <GuideCard tint="warning" icon={Workflow} step="6" title="将镜云连接到 Typora" description="在设置页复制 Typora 自定义上传命令，然后到 Typora → 偏好设置 → 图像中粘贴并验证。不需要同时安装其他图床工具。" action="Typora 配置" onClick={() => go('settings')} />
            <GuideCard tint="warning" icon={Settings2} step="7" title="按需开启进阶功能" description="熟悉基本上传后，再配置快捷键、右键菜单、ShareX 本机接口或多云备份；首次使用不需要一次全部设置。" action="全部设置" onClick={() => go('settings')} />
          </div>
        </div>
      </section>
    </div>
  )
}

function GuideCard({
  icon: Icon,
  tint = 'accent',
  step,
  title,
  description,
  action,
  onClick,
}: {
  icon: typeof Cloud
  tint?: GuideTint
  step: string
  title: string
  description: string
  action: string
  onClick: () => void
}) {
  const c = TINT[tint]
  return (
    <article className="flex h-full flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: c.bed, color: c.ink }}><Icon size={16} /></span>
        <span className="text-[11px]! font-semibold! uppercase tracking-[.12em] [font-variant-numeric:tabular-nums]" style={{ color: c.ink }}>STEP {step}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {/* flex-1 absorbs the row's equal-height slack inside the paragraph, so the actions land on one
          baseline across the grid instead of hanging at ragged distances under short descriptions. */}
      <p className="mt-2 flex-1 text-xs leading-6 text-[var(--text-secondary)]">{description}</p>
      <button onClick={onClick} className="mt-4 self-start text-[12px]! font-medium! hover:underline" style={{ color: c.ink }}>{action} →</button>
    </article>
  )
}

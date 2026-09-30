import { BookOpen, Boxes, Cloud, Copy, ExternalLink, Images, Upload, Workflow, X } from 'lucide-react'
import type { PageKey } from '../types'

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
            <h2 className="text-lg font-semibold">新手教程 · 图床</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">先完成第一次真实云端上传，再按需配置 Typora、插件和多云策略。这里的教程始终随应用提供，不依赖外部网站。</p>
          </div>
          {onlineDocsUrl && <button onClick={() => openExternalUrl(onlineDocsUrl)} className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px]! font-medium! text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><ExternalLink size={13} className="mr-1 inline" />在线文档</button>}
          <button onClick={onClose} className="shrink-0 rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]" aria-label="关闭教程"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <GuideCard icon={Cloud} step="1" title="连接一个真实云端" description="建议第一次先用 GitHub。填写 Owner、仓库、分支和 Token，点击“测试并保存”。Provider 配置窗口右上角还有对应平台的内置教程。" action="去云端" onClick={() => go('storages')} />
            <GuideCard icon={Upload} step="2" title="上传第一张图片" description="点击左侧“快速发布”，上传一张测试图片。任务成功意味着远端 Provider 已确认文件存在，而不是只写入了本地记录。" action="开始发布" onClick={() => go('publish')} />
            <GuideCard icon={Images} step="3" title="用“图库”检查远端" description="图库直接浏览 GitHub / R2 / OSS 等真实云端文件。以前就存在于云端的图片也应该从这里查看；它不依赖本机上传历史。" action="打开图库" onClick={() => go('gallery')} />
            <GuideCard icon={Boxes} step="4" title="理解“资源”页面" description="资源是图床维护的发布索引：记录名称、URL、部署状态和插件结果。图片本体仍在云端。旧的云端文件不会因为连接云端就自动变成本地发布记录。" action="查看资源" onClick={() => go('assets')} />
            <GuideCard icon={Copy} step="5" title="“复制”到底复制什么" description="资源页会按当前格式复制 URL、Markdown、HTML、BBCode 或自定义模板；图库里的“复制”表示复制该远端文件的公开 URL。" action="查看设置" onClick={() => go('settings')} />
            <GuideCard icon={Workflow} step="6" title="Typora 不是只能用 PicGo" description="图床通过 Typora 的“自定义命令”接入。配置向导会复制命令并打开 Typora；你需要在 Typora → 偏好设置 → 图像中把上传服务改成“自定义命令”，粘贴后验证。" action="Typora 配置" onClick={() => go('settings')} />
          </div>
        </div>
      </section>
    </div>
  )
}

function GuideCard({
  icon: Icon,
  step,
  title,
  description,
  action,
  onClick,
}: {
  icon: typeof Cloud
  step: string
  title: string
  description: string
  action: string
  onClick: () => void
}) {
  return (
    <article className="flex h-full flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={16} /></span>
        <span className="text-[11px]! font-semibold! uppercase tracking-[.12em] text-[var(--text-secondary)] [font-variant-numeric:tabular-nums]">STEP {step}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {/* flex-1 absorbs the row's equal-height slack inside the paragraph, so the actions land on one
          baseline across the grid instead of hanging at ragged distances under short descriptions. */}
      <p className="mt-2 flex-1 text-xs leading-6 text-[var(--text-secondary)]">{description}</p>
      <button onClick={onClick} className="mt-4 self-start text-[12px]! font-medium! text-[var(--accent)] hover:underline">{action} →</button>
    </article>
  )
}

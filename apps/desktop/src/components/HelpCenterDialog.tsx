import { BookOpen, Boxes, Cloud, Copy, ExternalLink, Images, Keyboard, Upload, Workflow, X } from 'lucide-react'
import type { PageKey } from '../types'

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
        className="theme-surface flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[30px] border shadow-[0_35px_120px_rgba(15,23,42,.28)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5">
          <div className="grid size-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><BookOpen size={18} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">新手教程 · 图床</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">先完成第一次真实云端上传，再按需配置 Typora、插件和多云策略。这里的教程始终随应用提供，不依赖外部网站。</p>
          </div>
          {onlineDocsUrl && <button onClick={() => openExternalUrl(onlineDocsUrl)} className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]"><ExternalLink size={13} className="mr-1 inline" />在线文档</button>}
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--surface-soft)]" aria-label="关闭教程"><X size={18} /></button>
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

          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Keyboard size={15} /> 推荐的第一次使用顺序</div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center text-[11px] max-lg:grid-cols-1">
              {['连接 GitHub', '上传 1 张图', '图库确认远端', '复制 Markdown', '再配置 Typora'].map((text, index) => (
                <div key={text} className="rounded-xl bg-[var(--surface)] px-3 py-3 text-[var(--text-secondary)]"><span className="mr-1 font-semibold text-[var(--accent)]">{index + 1}.</span>{text}</div>
              ))}
            </div>
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
    <article className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={16} /></div>
        <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--text-muted)]">STEP {step}</div>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">{description}</p>
      <button onClick={onClick} className="mt-4 rounded-xl bg-[var(--surface-soft)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:opacity-80">{action} →</button>
    </article>
  )
}

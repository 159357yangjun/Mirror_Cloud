export function ReadFailurePanel({ subject, error, className }: { subject: string; error: unknown; className?: string }) {
  return (
    <div className={className}>
      <div className="font-medium">{subject}读取失败</div>
      <div className="mt-1 text-xs">原始错误已折叠在下方，可展开复制给支持人员。</div>
      <details className="mt-3 text-left">
        <summary className="cursor-pointer text-xs font-medium">原始错误</summary>
        <div className="mt-2 break-all font-mono text-xs">{String(error)}</div>
      </details>
    </div>
  )
}

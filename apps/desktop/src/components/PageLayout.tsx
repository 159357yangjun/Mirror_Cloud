import type { ReactNode } from 'react'

type PageWidth = 'standard' | 'wide' | 'compact' | 'tasks' | 'plugins'

export function PageLayout({ children, width = 'standard', className = '' }: {
  children: ReactNode
  width?: PageWidth
  className?: string
}) {
  return <div className={`page-layout page-layout--${width} ${className}`.trim()}>{children}</div>
}

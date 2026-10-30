import type { ReactNode } from 'react'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-header-actions">{action}</div>}
    </header>
  )
}

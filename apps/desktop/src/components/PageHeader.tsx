import type { ReactNode } from 'react'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      {action}
    </header>
  )
}

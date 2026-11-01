import { useState } from 'react'

export interface SectionOption {
  id: string
  label: string
  keywords?: string
}

/** Page-local navigation. Content stays mounted in the owning page to retain drafts and jobs. */
export function SectionNavigation({ label, options, value, onChange, searchable = false }: {
  label: string
  options: readonly SectionOption[]
  value: string
  onChange: (value: string) => void
  searchable?: boolean
}) {
  const [query, setQuery] = useState('')
  const matches = options.filter((option) => `${option.label} ${option.keywords ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function choose(id: string) {
    setQuery('')
    onChange(id)
  }
  return (
    <div className="section-navigation">
      {searchable && <input type="search" aria-label="搜索设置功能" placeholder="搜索设置：复制、Typora、Token、更新…" value={query} onChange={(event) => setQuery(event.target.value)} className="section-search" />}
      <nav aria-label={label} className="section-navigation-buttons">
        {matches.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => choose(option.id)}>{option.label}{query.trim() && option.keywords && <span>{option.keywords}</span>}</button>)}
      </nav>
      {!matches.length && <p role="status" className="section-search-empty">没有找到对应设置，请换一个关键词。</p>}
    </div>
  )
}

import { useId, useState } from 'react'
import type { PluginView } from '../../types'
import { initialPluginConfig, pluginConfigErrors } from './config'

export function PluginSchemaForm({ plugin, busy, onSave }: {
  plugin: PluginView
  busy: boolean
  onSave: (config: Record<string, unknown>) => void
}) {
  const prefix = useId()
  const [config, setConfig] = useState(() => initialPluginConfig(plugin))
  const errors = pluginConfigErrors(plugin, config)
  const unsupported = Object.keys(plugin.config).some((name) => !(name in initialPluginConfig(plugin)))
  const [acknowledged, setAcknowledged] = useState(false)
  const change = (name: string, value: unknown) => setConfig((old) => {
    const next = { ...old }
    if (value === undefined) delete next[name]
    else next[name] = value
    return next
  })
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!Object.keys(errors).length && (!unsupported || acknowledged)) onSave(config) }}>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      {Object.entries(plugin.configSchema).map(([name, field]) => {
        const id = prefix + '-' + name
        const value = config[name] ?? ''
        const props = { id, 'aria-invalid': !!errors[name], 'aria-describedby': id + '-help', className: 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm' }
        return <div key={name}>
          <label htmlFor={id} className="mb-1 block text-xs font-medium">{field.title || name}{field.required ? ' *' : ''}</label>
          {field.type === 'boolean'
            ? <input id={id} aria-invalid={!!errors[name]} aria-describedby={id + '-help'} type="checkbox" checked={value === true} onChange={(e) => change(name, e.target.checked)} />
            : field.enum
              ? <select {...props} value={typeof value === 'string' ? value : ''} onChange={(e) => change(name, e.target.value === '' ? undefined : e.target.value)}><option value="">请选择</option>{field.enum.map((item) => <option key={item} value={item}>{item}</option>)}</select>
              : field.type === 'number' || field.type === 'integer'
                ? <input {...props} type="number" step={field.type === 'integer' ? 1 : 'any'} min={field.minimum} max={field.maximum} value={typeof value === 'number' ? value : ''} onChange={(e) => change(name, e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                : <textarea {...props} rows={field.type === 'url' ? 2 : 3} value={typeof value === 'string' ? value : ''} onChange={(e) => change(name, e.target.value)} />}
          <p id={id + '-help'} className={errors[name] ? 'text-xs text-red-600' : 'text-xs text-slate-500'}>{errors[name] || field.description}</p>
        </div>
      })}
      {!Object.keys(plugin.configSchema).length && <p className="text-xs text-slate-500">此插件没有可配置字段。</p>}
      {!plugin.enabled && <p className="text-xs text-slate-500">关闭状态可保存未完成配置，开启前需要填写必填项。密钥请使用 AI 配置中的系统凭据设置。</p>}
      {unsupported && <label className="flex gap-2 text-xs text-amber-700"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />现有配置含不支持的字段。确认保存时移除这些字段，未确认前保留原配置。</label>}
      <button type="submit" disabled={!!Object.keys(errors).length || (unsupported && !acknowledged)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">{busy ? '保存中…' : '保存配置'}</button>
    </fieldset>
  </form>
}

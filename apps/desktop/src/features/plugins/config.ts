import type { PluginView } from '../../types'

export function initialPluginConfig(plugin: PluginView): Record<string, unknown> {
  const config: Record<string, unknown> = Object.create(null)
  for (const [name, field] of Object.entries(plugin.configSchema)) {
    const value = plugin.config[name] ?? field.default
    if (value !== undefined) config[name] = value
  }
  // Preserve the two legitimate non-secret historical AI overrides.
  if (plugin.kind === 'aiprompt' || plugin.kind === 'ai_prompt') {
    for (const name of ['baseUrl', 'model']) {
      if (typeof plugin.config[name] === 'string') config[name] = plugin.config[name]
    }
  }
  return config
}

export function pluginConfigErrors(plugin: PluginView, config: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = Object.create(null)
  for (const [name, field] of Object.entries(plugin.configSchema)) {
    const value = config[name]
    if (value === undefined) {
      if (field.required && plugin.enabled) errors[name] = '此项必填'
      continue
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') errors[name] = '请选择开关状态'
    } else if (field.type === 'number' || field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)
        || (field.type === 'integer' && !Number.isSafeInteger(value))) errors[name] = '请输入有效数字'
      else if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) errors[name] = '数字超出允许范围'
    } else {
      if (typeof value !== 'string') { errors[name] = '请输入文本'; continue }
      const length = [...value].length
      if (field.required && plugin.enabled && !value.trim()) errors[name] = '此项必填'
      if (length < (field.minLength ?? 0) || length > (field.maxLength ?? 4096)) errors[name] = '文本长度不符合要求'
      if (field.enum && !field.enum.includes(value)) errors[name] = '请选择允许的选项'
      if (field.type === 'url' && value !== '') {
        try {
          const url = new URL(value)
          const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
          if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) errors[name] = '请使用 HTTPS 或本机回环地址，勿内嵌凭据'
        } catch { errors[name] = '请输入有效地址' }
      }
    }
  }
  return errors
}

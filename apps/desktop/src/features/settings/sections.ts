export const settingsSections = [
  { id: 'output', label: '上传与复制', keywords: '链接输出 URL Markdown HTML BBCode 图片格式 WebP PNG JPEG 自定义模板 自动复制' },
  { id: 'integration', label: '快捷集成', keywords: 'Typora 编辑器 全局快捷键 剪贴板 Windows 右键菜单' },
  { id: 'security', label: '接口与安全', keywords: '本机 HTTP API Token 令牌 密钥 凭据 安全说明' },
  { id: 'migration', label: '数据迁移', keywords: '导入 导出 备份 存储清单 工作流 多云组 图片元数据 暂存 审核' },
  { id: 'background', label: '后台检查', keywords: '对账 扫描间隔 云端索引 刷新 扫描记录' },
  { id: 'about', label: '关于与诊断', keywords: '版本 检查更新 下载 安装 本地数据 目录 数据库 系统诊断' },
] as const

export type SettingsSection = typeof settingsSections[number]['id']

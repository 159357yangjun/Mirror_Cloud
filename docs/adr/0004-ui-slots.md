# ADR 0004 — UI 贡献：slot registry + 构建期插件入口

- 状态：Accepted（2026-11-16）
- 相关：ADR 0001/0002/0003；基线 `main@69ec25d`，前端 62 文件 / 8,391 行

## 背景

`apps/desktop/src/App.tsx:41-53` 用 `page === 'publish' | 'assets' …` 硬切换 8 个页面；设置页也是单文件堆叠。禁用插件后无法让页面/导航/设置分区一起消失。插件 UI 若靠运行时远程加载（eval/iframe），会破坏离线可用与 CSP。

## 决策

### 1. Slot 定义（v1 只开 5 个）

| slot | 用途 | 渲染位置 |
|---|---|---|
| `nav.main` | 主导航项 | `AppShell` 侧栏/底部导航 |
| `page.main` | 主内容页面 | `PageHost`（替换 `App.tsx` 的 switch） |
| `settings.section` | 设置页分区 | `SettingsPage` 的 section 容器 |
| `settings.storage` | 存储配置子表单 | 存储表单内的 provider 专属区 |
| `tray.menu` | 托盘菜单项 | Rust 托盘骨架读取 manifest `tray_items`，前端仅做配置 UI |

### 2. 注册 API

```ts
export type Slot = 'nav.main' | 'page.main' | 'settings.section' | 'settings.storage' | 'tray.menu';

export interface UiContribution {
  slot: Slot;
  id: string;                 // 全局唯一，建议 `${pluginId}.${name}`
  title?: string;
  icon?: string;
  order: number;              // 升序，冲突时按 id 字典序兜底
  when?: string;              // 可选：`setting:<pluginId>.<key>` 布尔谓词
  entry: () => Promise<{ default: React.ComponentType<any> }>;
}

export interface UiRegistry {
  add(c: UiContribution): void;
  get(slot: Slot): UiContribution[];
}
```

- 页面组件保持现有实现（`pages/*.tsx` 原样搬家），只改 import 与注册方式；
- 插件 UI 入口固定为 `apps/desktop/src/plugins/<pluginId>/index.tsx`，导出 `register(registry)`；
- 收集方式：`import.meta.glob('./plugins/*/index.tsx', { eager: true })`，**构建期打包**，不做运行时远程加载；
- 启用态来自 `bootstrap_snapshot` 的插件列表；`set_plugin_enabled` 成功后前端重新拉取 bootstrap 并重渲染 registry，不整页刷新。

### 3. 禁用语义

- 禁用插件 → 其全部贡献从 registry 移除，导航项、页面、设置分区同时消失；
- 已停留在被禁用插件的路由 → 显示「插件已禁用」占位页，提供「去插件页启用」与「返回发布页」；
- 子路由/深链（如 `page=workflows`）在禁用后回落到 `publish`，不保留死链。

### 4. 视觉与体积约束

- 页面视觉以 `docs/VISUAL_BASELINE.md` 基线图为准；迁移只允许挂载点差异，样式 token 不改（`verify_shape.mjs` 基线同步更新需单独提交并说明）；
- 打包产物预算：首屏 chunk 增幅 ≤10%，插件的惰性 chunk 总量不计入首屏；超预算则把页面组件改为 `React.lazy`。

## 拒绝的替代方案

1. **运行时 iframe/Module Federation**：离线、CSP、样式隔离成本高，v2 再评估；
2. **保留 switch，使用 feature flag 隐藏**：代码仍在主 bundle，禁用后依赖仍存在，且无法表达第三方页面；
3. **每个插件独立 HTML 入口**：Tauri 单窗口模型下路由/BFCache 复杂，收益低。

## 后果

- 前端出现 `src/kernel/`（registry、PageHost、AppShell）与 `src/plugins/*` 两层目录；
- 新增页面 = 在插件 `ui/index.tsx` 注册 + manifest 声明，不再改 `App.tsx`；
- 需要一次性建立 5 个 slot 的渲染契约测试（P1 引入），防止插件注册了但永远不渲染。

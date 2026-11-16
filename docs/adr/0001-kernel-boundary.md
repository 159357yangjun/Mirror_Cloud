# ADR 0001 — 内核边界：保留「发布闭环 + 宿主」，其余全部插件化

- 状态：Accepted（2026-11-16，边界经用户确认）
- 相关：`docs/PLUGIN_FIRST_ARCHITECTURE.md`、ADR 0002/0003/0004
- 基线：`main@69ec25d`，1.4.16

## 背景

当前仓所有能力都在一个进程内，靠 `match` 与命令清单耦合：

- `apps/desktop/src-tauri/src/services/provider_factory.rs:35-87` 按 `provider_key` 硬编码 6 家 provider；
- `apps/desktop/src-tauri/src/commands.rs` 138,376 字节、26 条命令，混装发布、存储、工作流、插件管理；
- `apps/desktop/src/App.tsx:41-53` 用 `page === '…'` 硬切换 8 个页面；
- `docs/PLUGIN_ARCHITECTURE.md:35-41` 的插件系统只支持 template/webhook/ai_prompt 三种声明式 kind。

结果：新增一家图床、一种处理步骤、一个页面，都要改内核文件并重跑全量回归；也无法让用户关掉不需要的能力。

## 决策

内核只保留「一张图进、一个 URL 出」的闭环和宿主能力，业务能力全部变成插件。

### 内核保留（不可插件化）

| 领域 | 内容 | 理由 |
|---|---|---|
| 应用壳 | 窗口、托盘骨架、单实例、关闭到托盘、窗口布局 | OS 集成与进程生命周期，插件化无收益 |
| 更新与签名 | `commands/updater.rs`、`update_security.rs`、Ed25519 清单校验 | 安全边界，必须独立于插件供应链 |
| 插件宿主 | manifest v1/v2 解析、注册表、权限 Gate、hook 总线、`plugin_invoke`、审计、启停 | 扩展机制本身 |
| 存储地基 | `StorageProvider` port、凭据库、S3 兼容 provider（R2/S3/MinIO） | 保证「零插件也可发布」的兜底 |
| 发布闭环 | 单目标上传、readback 校验、回滚、Asset/Deployment/journal 落库、`asset://published` | 产品最核心不变量 |
| 数据 | SQLite 迁移与核心仓储、任务队列、设置存储 | 单一写者、可回滚 |
| 基础 UI | 发布页、上传记录页、插件页、设置骨架（存储基础项/通用/更新/插件配置） | 首启即可用 |
| 入口适配 | CLI 骨架、Local HTTP 服务骨架（路由由插件贡献） | 与桌面共用同一插件集 |

### 插件承接（14 个内置）

`provider-github`、`provider-gitee`、`provider-opendal-extra`（OSS/COS/WebDAV）、`image-transform`、`workflow`、`publish-strategy`、`reconcile`、`cloud-browser`、`portable-migration`、`task-console`、`integrations-os`（Typora/快捷键/右键菜单/Local API 路由）、`ai-assistant`、`themes`、`diagnostics`。

每个插件一律走 manifest（ADR 0002）、命令分发（ADR 0003）、UI slot（ADR 0004）。

## 拒绝的替代方案

1. **微内核（连发布闭环也插件化）**：发布不变量会散落到插件，回滚/校验语义无法统一，风险高、收益低。
2. **只做配置开关（if 判断）**：代码仍耦合，禁用后内核仍持有业务依赖，不满足「内核不引用插件」。
3. **完全保留单体，仅补文档**：无法解决新增 provider/页面必须改内核的问题。

## 后果

- 内核 crate 的依赖图受 CI 约束（`scripts/check_kernel_deps.py`，P1 引入），`crates/plugins/*` 不能进入内核依赖；
- 命令面从 99 条收敛到「≤30 条内核命令 + 一个 `plugin_invoke`」；
- 每个能力的回归、禁用态、文档都可独立验收；
- 代价：需要 11 周分阶段迁移，且插件契约一旦发布难以无损变更（v1 用 JSON Schema 固定，v2 换执行器不改契约）。

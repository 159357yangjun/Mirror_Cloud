# v1.3.4 — Lifecycle Completion & Persistent Cloud Tasks

这一版继续优化产品完成度，不增加 Provider 数量。重点把 v1.3.3 的“插件触发器 + 批量云端操作”推进成可长期维护的统一机制。

## 1. 插件生命周期补齐第一版闭环

`PluginHook` 现在包含：

- `before_process`
- `after_process`
- `after_upload`
- `on_publish_failure`
- `on_gallery_delete`
- `manual_trigger`

官方 Webhook v1.2.0 支持全部 Hook。Markdown Card 与 AI Caption 仍只开放与自身语义匹配的 Hook，不为了“数量”强行参与处理前/失败事件。

用户启用的 Hook 仍单独保存在 `enabled_hooks_json`。Manifest 支持某个 Hook，并不代表用户自动授权它执行。

## 2. Desktop / Typora / Local HTTP API 生命周期一致

Desktop Workflow 与直接发布路径会在处理前、处理后、上传后、发布失败位置触发对应 Hook。

Typora 与 Local HTTP API 复用 CLI bridge，因此这次同步接入相同生命周期，不再出现“桌面支持、编辑器入口不支持”的分叉。

Hook 失败默认作为插件 warning，不会把已经成功的主上传错误地标记为云端失败；`on_publish_failure` 自身失败只记录 warning。

## 3. 安全升级迁移

新增 `0012_official_webhook_lifecycle.sql`：

- 官方 Webhook Manifest 更新到 v1.2.0；
- 增加完整 Hook 声明；
- **不修改 `enabled_hooks_json`**。

因此已有用户如果此前只启用 `after_upload`，升级后仍只执行 `after_upload`。新能力需要用户在插件页显式开启。

## 4. Cloud Move 规则下沉 Application Core

新增 `application::CloudMutationCore`，统一负责：

1. 目标路径存在检查，禁止静默覆盖；
2. Provider 原生 `move_object` 优先；
3. 不支持原生 move 时，受控执行 `download → upload → delete`；
4. 如果源删除失败，尝试删除刚上传的目标副本进行回滚；
5. fallback 上传根据目标路径推断 Content-Type。

Tauri command 只负责 Provider 构建、SQLite Deployment 同步与 UI 返回，不再自己维护云端 Move 算法。

## 5. 批量云端操作进入持久化 Task Center

新增后台命令：

- `queue_batch_delete_storage_entries`
- `queue_batch_move_storage_entries`
- `queue_batch_rename_storage_entries`

Cloud Manager UI 现在提交任务后立即释放页面，任务类型分别持久化为：

- `cloud_batch_delete`
- `cloud_batch_move`
- `cloud_batch_rename`

Task Center 会显示运行、完成、部分失败或失败状态。应用异常退出时，这些运行中的任务继续使用现有 `recover_interrupted()` 规则明确标记为中断失败，不会永远停在 running。

## 6. 修复一个潜在 Rust 编译问题

v1.3.3 CLI 中构造 `PluginContext` 时仍沿用旧字段，缺少后来新增的 `metadata`。由于当前打包容器没有 Rust toolchain，这类问题无法通过 `cargo check` 自动发现。v1.3.4 已修正该结构，并将 CLI 改为统一的 `execute_for_hook`。

## 7. 保留边界

本版仍不声明：

- Rust `cargo check/test` 已通过；
- Windows 安装包已构建；
- 真实云端批量 Move/Delete 已完成网络 E2E；
- Webhook 六类生命周期已做真实网络接收测试。

这些必须在具备 Rust、Windows 和真实 Provider 凭据的环境中继续验证。

# v1.3.5 — Task Control, Plugin Observability & Diagnostics

这一版继续做正式发布前的可靠性收口，不增加 Provider。重点把 v1.3.4 的“持久化 Cloud Manager 任务”和“插件生命周期”从可执行推进到可控制、可追踪、可诊断。

## 1. Cloud Manager 后台任务支持 cooperative cancel

新增 `cancel_task`。当前只开放给 `cloud_batch_delete / cloud_batch_move / cloud_batch_rename`，因为这三类 worker 已经实现逐项 cancellation point；尚未支持 cooperative cancellation 的上传任务不会提供假取消。

每个远端对象处理前后都会调用任务状态检查。进度更新使用带 active-state WHERE 条件的 SQL，因此取消后 worker 不能再把状态写回 `running`。

## 2. 失败/取消任务支持有限重试

新增 `retry_task`：

- 仅失败或已取消的 Cloud Manager 批量任务可重试；
- 直接复用 SQLite 中原始 `payload_json`，UI 不重新拼参数；
- `attempt` 持久化递增；
- `max_attempts` 到达后拒绝继续重试；
- 重试使用原 Task ID，Task Center 可以看到同一任务的重试次数。

## 3. 批量任务进度改成逐项更新

旧版后台批处理主要显示 10% → 100%。v1.3.5 会按已处理项把进度映射到 10%–90%，最终完成/失败再进入 100%。

## 4. 插件执行审计

新增 migration `0013_plugin_execution_logs.sql` 和 `plugin_execution_logs`：

- plugin id / name；
- lifecycle hook；
- success / failed；
- duration_ms；
- failure summary；
- created_at。

Desktop、Typora / Local HTTP API bridge 以及 manual trigger 都写入同一份审计。审计失败本身不会反向破坏主上传。

插件页新增“插件执行记录”，用于排查 Webhook endpoint、AI Provider、权限与生命周期问题。

## 5. 系统诊断

Settings 新增只读诊断面板，聚合：

- Local HTTP API 运行状态；
- Storage 总数 / enabled 数；
- Plugin 总数 / enabled 数；
- Task 总数 / active / failed；
- default Workflow；
- 可操作 warning。

## 6. 升级安全

`0013` 只新增审计表与索引，不修改已有插件、任务或授权数据。已实际模拟 v1.3.4 数据库升级：原插件 `enabled_hooks_json`、enabled 状态和任务 attempt/error 均保持不变。

## 7. 保留边界

本版仍不声明：

- Rust `cargo check/test` 已通过；
- Windows 安装包已构建；
- 真实云端任务中途取消 E2E 已跑；
- 真实 Webhook/AI 插件审计网络 E2E 已跑。

这些必须在具备 Rust、Windows、网络和真实 Provider/Plugin 凭据的环境中继续验证。

# ADR 0003 — 命令分发：内核强类型命令 + `plugin_invoke`

- 状态：Accepted（2026-11-16）
- 相关：ADR 0001/0002/0004、`docs/PLUGIN_COMMAND_MAP.md`
- 基线：`main@69ec25d`；99 条 `#[tauri::command]`、`lib.rs:135-235` 注册 106 项、前端 98 处 `invoke(`（含泛型写法共 101）

## 背景

命令全部集中注册，导致：

- 任何插件命令都必须回到 `lib.rs` 增删注册项；
- 前端与命令名一一耦合（`check_contracts.py` 静态对账），插件无法自带命令；
- 权限只能按「插件级」粗粒度授予，不能按命令声明（例如 cloud-browser 的写操作）。

## 决策

### 1. 内核命令

内核保留的业务命令**不改名、不改参数**（先降风险，迁移期前端零改动）：

- 数量目标 ≤30 条（P1 先保持现状，P4 收敛 `create_*_storage` 为 `create_storage(provider_key, config_json)` 并合并输出偏好命令）；
- 统一从 `apps/desktop/src-tauri/src/commands/core/*.rs` 导出，`lib.rs` 只注册一次；
- 内核命令必须强类型（serde 结构体），不接受任意 JSON。

### 2. 插件命令

唯一通用入口：

```rust
#[tauri::command]
async fn plugin_invoke(
    state: State<'_, AppState>,
    plugin_id: String,
    method: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, PluginInvokeError>;
```

分发器依次执行：

1. 插件存在且 `enabled == true`，否则 `disabled`；
2. `(plugin_id, method)` 已在该插件 manifest 的 `contributes.commands` 中声明，否则 `unknown_method`；
3. 命令声明的 `permission` 已被用户授权，否则 `permission_denied`；
4. `payload` 通过 `input_schema` 校验，否则 `invalid_payload`；
5. 按声明超时执行（默认 30 s，最大 120 s；v1 webhook 同样 30 s）；
6. 返回 JSON 通过 `output_schema` 校验（P2 起启用）；
7. 写审计：`plugin_execution_logs`（`run_plugin` 已有），记录 plugin_id/method/耗时/结果码，**不记录 payload 原文**。

错误码固定：`disabled | unknown_method | permission_denied | invalid_payload | timeout | internal`，前端按码提示，不再解析自由文本。

### 3. 前端 SDK

`apps/desktop/src/lib/desktop.ts` 新增：

```ts
export function invokePlugin<T>(pluginId: string, method: string, payload?: unknown): Promise<T>
```

- 迁移期：旧 `invoke('publish_files_with_workflow')` 保持可用（内核命令），插件命令一律走 `invokePlugin`；
- P4 后：`desktop.ts` 中出现的插件命令名归零，`check_contracts.py` 断言这一点。

### 4. 契约检查改造

`scripts/check_contracts.py` 的规则从「`invoke(` ↔ Rust 命令名」改为：

- 内核命令：`invoke(` 出现的名字必须在内核白名单（从 `lib.rs` 注册表生成）；
- 插件命令：`invokePlugin(` 的第一个参数为字面量 plugin id、第二个参数必须出现在该插件 `plugin.json` 的 `contributes.commands`；
- 反向：每个内核命令至少被引用一次，每个插件命令至少被引用一次（允许 `testsOnly` 标记）。

## 拒绝的替代方案

1. **每插件一个 Tauri 命令**：仍需回 `lib.rs` 注册，违背「插件自包含」。
2. **动态 `generate_handler!` 宏**：Tauri 2 不支持运行时注册；即使支持，权限/审计也难统一。
3. **让前端直接调 Local HTTP**：绕过 Tauri 权限模型，本地端口暴露面变大。

## 后果

- IPC 面从「106 项注册」变「30 项内核 + 1 项分发」；
- 插件命令的入参校验成本移到 JSON Schema（编译期由 `kernel-api` 生成校验器或 `jsonschema` crate，P1 选型）；
- 错误码统一后，前端可做统一 toast，但需要重写约 20 处 `catch` 文案；
- `plugin_invoke` 成为唯一需要重点审计的入口（日志字段固定）。

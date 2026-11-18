# 插件化命令映射（100 条 `#[tauri::command]`）

- 生成时间：2026-11-16，基线 `main@69ec25d`
- 数据来源：本会话对 `apps/desktop/src-tauri/src` 的静态扫描（`#[tauri::command]` 正则，O），P0 扫描合计 99 条；P1 新增内核命令 `plugin_invoke` 后为 100 条（`check_contracts.py` 复核：前端 99 / Rust 100 / 注册 100）
- 迁移动线：P1 只改传输与注册方式，不改命令名；P2 起按本表逐插件搬移；P4 收敛内核命令

## 统计

| 归属 | 条数 | 迁移阶段 |
|---|---|---|
| 内核 | 38 | 保留（P4 收敛到 ≤30） |
| `workflow` | 6 | P2 |
| `publish-strategy` | 4 | P2 |
| `reconcile` | 4 | P2 |
| `cloud-browser` | 14 | P2 |
| `portable-migration` | 21 | P2 |
| `integrations-os` | 9 | P2 |
| `ai-assistant` | 3 | P2 |
| `diagnostics` | 1 | P2 |
| 合计 | 100 | — |

## 内核命令（38）

来源文件：`commands.rs`（16）、`commands/plugins.rs`（10）、`commands/plugin_import.rs`（2）、`commands/updater.rs`（4）、`commands/integrations.rs`（3）、`commands/storage_entries.rs`（2）、`commands/plugin_invoke.rs`（1，P1 新增）。

| 命令 | 来源 | 说明 |
|---|---|---|
| `bootstrap_snapshot` | commands.rs | 启动快照，P1 增加插件/能力列表 |
| `get_default_publish_target` / `set_default_publish_target` | commands.rs | 发布默认目标 |
| `create_s3_storage` | commands.rs | 内核兜底 provider（R2/S3/MinIO） |
| `create_object_storage` / `create_webdav_storage` / `create_repository_storage` | commands.rs | P4 收敛为 `create_storage(provider_key, config_json)`，校验交给插件 schema |
| `list_storages` / `delete_storage` / `test_storage` | commands.rs | 通用，按注册表分发 |
| `publish_files_with_workflow` / `publish_urls_with_workflow` / `publish_clipboard_image_with_workflow` | commands.rs | 发布闭环入口，工作流步骤由插件提供 |
| `delete_asset` / `list_assets` / `list_tasks` | commands.rs | 资产与任务查询 |
| `list_plugins` / `list_marketplace_plugins` / `list_plugin_execution_logs` / `install_marketplace_plugin` / `set_plugin_enabled` / `set_plugin_permissions` / `set_plugin_hooks` / `save_plugin_config` / `delete_plugin` / `run_plugin` | commands/plugins.rs | 插件宿主管理面 |
| `preview_local_plugin` / `install_local_plugin` | commands/plugin_import.rs | v1 声明式插件安装 |
| `check_for_updates` / `get_update_status` / `download_update` / `install_update` | commands/updater.rs | 更新器安全边界 |
| `open_app_data_dir` | commands/integrations.rs | 通用工具 |
| `get_output_preferences` / `save_output_preferences` | commands/integrations.rs | 输出偏好（P4 并入设置命令） |
| `cancel_task` / `retry_task` | commands/storage_entries.rs | 任务队列（与 cloud-browser 同文件，归属内核） |
| `plugin_invoke` | commands/plugin_invoke.rs | P1 统一插件入口：`plugin_id + method + payload`，错误码见 ADR 0003 |

## 插件命令

### `workflow`（6）

`list_recipes`、`create_workflow_from_recipe`、`create_custom_workflow`、`list_workflows`、`set_default_workflow`、`delete_workflow`（来源 `commands.rs`）。

发布入口 `publish_*_with_workflow` 仍在内核；插件只提供步骤定义、命名模板与配方。

**P2 落地（2026-11-18）**：实现在 `crates/plugins/workflow/src/lib.rs`（`plugin-workflow`），上表六条命令改为薄包装委托
`kernel.invoke("workflow", "workflow.<method>", payload)`，方法名为 `workflow.list_recipes` / `workflow.create_from_recipe` /
`workflow.create_custom_workflow` / `workflow.list_workflows` / `workflow.set_default_workflow` / `workflow.delete_workflow`。
原 `commands.rs` 的配方目录（`builtin_recipes`）、`workflow_from_fields` 组合与 `WorkflowView` 映射随实现迁入插件（命令层保留
`workflow_from_fields`/`validate_publish_target` 供默认管线维护路径复用）。命令名、入参与返回结构对前端不变。

### `publish-strategy`（4）

`create_storage_group`、`list_storage_groups`、`delete_storage_group`、`repair_asset`（来源 `commands.rs`）。

**P2 落地（2026-11-18）**：`create_storage_group`/`list_storage_groups`/`delete_storage_group` 已迁入插件 crate `crates/plugins/publish-strategy`，命令层改为薄包装，分别委托 `publishStrategy.create_group` / `publishStrategy.list_groups` / `publishStrategy.delete_group`；群组校验、私有 R2/S3 混组拒绝与 group view 序列化随迁移进入插件。`delete_storage_group` 保留内核的默认目标守卫、`sync_system_default_pipeline` 与 `cleanup_legacy_workflows_referencing_target` 前置逻辑（属于系统默认管线职责，非插件边界）。`repair_asset` 暂留内核：依赖 provider 工厂与 `tauri::AppHandle` 任务事件（`emit_task`），待 P3 抽出 provider factory 后再迁。

### `reconcile`（4）

`run_reconciliation_sweep`、`get_reconciliation_settings`、`set_reconciliation_settings`、`get_reconciliation_history`（来源 `commands/reconcile.rs`）。

### `cloud-browser`（14）

`browse_storage`、`create_temporary_share_link`、`preview_private_storage_entry`、`delete_storage_entry`、`download_storage_entry`、`move_storage_entry`、`create_storage_directory`、`batch_delete_storage_entries`、`batch_move_storage_entries`、`batch_rename_storage_entries`、`queue_batch_delete_storage_entries`、`queue_batch_move_storage_entries`、`queue_batch_rename_storage_entries`（来源 `commands/storage_entries.rs`），以及 `sync_storage_asset_index`（来源 `commands/remote_index.rs`）。

### `portable-migration`（21）

`commands/portable_assets.rs`（10）：`export_portable_asset_manifest`、`inspect_portable_asset_manifest`、`preview_portable_asset_restore`、`stage_portable_asset_manifest`、`list_portable_asset_staging`、`list_portable_staged_items`、`update_portable_staged_item_review`、`discard_portable_asset_staging`、`apply_portable_staged_batch_decision`、`assess_portable_asset_activation`；

`commands/portable_backup.rs`（4）：`export_portable_storage_manifest`、`export_portable_reconnect_map`、`inspect_portable_reconnect_map`、`inspect_portable_storage_manifest`；

`commands/portable_references.rs`（7）：`export_portable_reference_manifest`、`inspect_portable_reference_manifest`、`preview_portable_reference_restore`、`restore_portable_storage_group`、`export_portable_group_mapping`、`inspect_portable_group_mapping`、`restore_portable_workflow`。

### `integrations-os`（9）

`get_global_shortcut_info`、`set_global_shortcut_enabled`、`get_windows_context_menu_info`、`install_windows_context_menu`、`uninstall_windows_context_menu`、`get_local_api_info`、`regenerate_local_api_token`、`get_typora_integration_info`、`open_typora`（来源 `commands/integrations.rs`）。

### `ai-assistant`（3）

`get_ai_settings`、`save_ai_settings`、`ai_plan_workflow`（来源 `commands/plugins.rs`，P2 拆出）。

### `diagnostics`（1）

`get_system_diagnostics`（来源 `commands/integrations.rs`）。

## P1 落地（2026-11-16）

- 内核 crate：`crates/kernel-api`（清单 v2 类型）、`crates/plugin-host`（注册/开关/贡献/分发）、`crates/kernel`（14 个内置插件装配）；`src-tauri` 仅做 `AppState.kernel` 装配与 `plugin_invoke` 边界转换。
- 可调用方法：P1 只有 `diagnostics.get` 真实返回；其余 13 个插件的方法随 P2 迁移逐个落地，未实现时返回 `unknown_method`（不伪造成功）。
- 前端：`apps/desktop/src/plugin-ui/registry.ts` 当前映射 7 个页面（assets/storages/plugins/settings + publish/gallery/tasks）；`page.workflows` 贡献已在清单声明，但同一页面在迁移前从未渲染，P2 随 workflow UI 迁移补齐，行为保持不变。
- 契约脚本：`scripts/check_kernel_deps.py`（依赖方向）、`scripts/check_plugin_contracts.py`（14 插件/14 贡献/9 贡献点 + schema/ADR/registry 存在性）。

## 契约检查口径（P1 起）

- 内核命令：`invoke(` 的名字必须命中内核白名单（由 `lib.rs` 注册表生成）；
- 插件命令：`invokePlugin('<plugin-id>', '<method>', …)` 必须命中该插件 `plugin.json` 的 `contributes.commands`；
- 双向覆盖：每个命令至少被引用一次，孤儿命令要么标注 `tests_only`，要么删除；
- 迁移期允许同一命令「内核路径 + 插件路径」并存，但同一提交内必须收敛为一条路径。

## 收敛清单（P4）

1. `create_object_storage` / `create_webdav_storage` / `create_repository_storage` → `create_storage(provider_key, config_json)`；
2. `get_output_preferences` / `save_output_preferences` → 并入 `get_settings` / `save_settings`；
3. `list_marketplace_plugins` / `install_marketplace_plugin` → v1 只保留只读列表，v2 再接市场；
4. 目标：内核命令 30 条以内（P1 后 38 条），其余 70 条全部经 `plugin_invoke`。

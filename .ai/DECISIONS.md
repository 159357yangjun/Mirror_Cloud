# DECISIONS

当前更新签名、正式发布与插件前三项实施均已有用户授权，无待重复批准事项。按已定范围收口，不加入社区索引或 WASM。更高版本签名下载/安装和插件原生 UI 实测缺口如实保留，不因等待用户交互而扩大结论。长期规则见 AGENTS.md。

## 2026-11-16 — 插件化边界与契约（P0）

- 内核边界：保留应用壳/托盘骨架/更新器与签名/插件宿主/存储 port+凭据+S3 兜底/单目标发布闭环/任务队列与 SQLite/基础 UI/CLI 与 Local HTTP 骨架；其余全部迁插件（ADR 0001）。用户已确认该边界。
- 插件范围：v1 仅 14 个内置插件（默认启用、允许禁用、不允许卸载）；第三方安装/市场/签名/WASM 放 v2（用户确认）。产品版本 2.0.0 与新增两张表的 DDL **尚未授权**，P0 不触库、不改版本号。
- 契约：manifest v2 + 9 个贡献点白名单；命令统一 `plugin_invoke`，内核命令保留原名并收敛 ≤30 条；UI 用 5 个构建期 slot（ADR 0002–0004）。
- 验证口径：静态基线用 `scripts/baseline_metrics.py`（原始行数）跨阶段对比；运行时性能基线交云端 CI 采集，不伪造。

## 2026-11-16 — 插件化 P1 落地（内核契约 crate）

- crate 切分：`kernel-api` 只放纯数据类型（不依赖任何插件/存储/Tauri），`plugin-host` 只做注册/开关/贡献/分发，`kernel` 只做 14 个内置插件装配；三者都不依赖 `domain`/`storage-*`/`persistence-*`，由 `scripts/check_kernel_deps.py` 守卫。
- `plugin_invoke` 传输：`pluginId + method + payload(Optional)`，错误用 `PluginInvokeError{plugin_id,method,code,message}`（camelCase），锁中毒映射 `internal`；其余 13 个插件在 P2 迁移前实现为 `PendingPlugin` 并返回 `unknown_method`，绝不伪造成功。
- 清单校验分层：`kernel-api::validate()` 只管结构性约束（版本、id、贡献唯一、能力去重、schema 体积），`native 必须 builtin` 与「WASM 一律拒绝」由宿主/校验层执行；`PluginKind::Wasm` 在 v1 直接拒绝。
- 前端页面发现：内核页（assets/storages/plugins/settings）优先，插件页按 `import.meta.glob('../plugins/*/ui.ts')` 注册并去重；P1 只映射 publish/gallery/tasks 三页。`page.workflows` 在迁移前从未渲染，P1 不补映射以免行为漂移，P2 随 workflow UI 迁移补齐。
- 迁移顺序：P2 按命令映射逐插件搬移（先 workflow/publish-strategy/reconcile 等读多写少组），每个插件搬完即补 `BuiltinPlugin` 实现与 `plugin_invoke` 切换，`check_contracts.py` 同步改为双向对账；P1 不切换任何既有前端调用。
- 契约同形性：`kernel-api::PluginManifestV2` 的 `contributes` 是宿主归一化形式（`Vec<Contribution>`），与 `docs/schemas/plugin-manifest-v2.schema.json` 的对象形态存在偏差；v1 内置插件不读磁盘 `plugin.json`，故 P1 不受影响。P2 加加载器时补 round-trip 断言（已记入 ADR 0002）。

## 2026-11-17 — P2 起步：异步插件契约与 diagnostics 迁移

- 同步 `invoke` 无法在插件内 `await` 仓储（桌面命令处于 tokio runtime，`block_on` 会 panic），故 `BuiltinPlugin::invoke` 改 `async_trait`，`PluginHost`/`Kernel::invoke` 一并 async；`AppState.kernel` 改 `tokio::sync::RwLock`（ADR 0005）。
- 插件不接收 context 参数：仓储/凭据/运行态句柄在构造期注入插件实例（`SqlitePool` 克隆廉价），`BuiltinPlugin` 签名保持 `invoke(&self, method, payload)`。
- 迁移方式：`PluginHost::register_override(instance)` 用真实实现替换同 id 占位实例，**清单唯一来源仍是内核装配表**；未知 id 报 `unknown_host`，替换不改清单/开关/贡献点，避免插件自述清单漂移。
- 迁移期 Tauri 命令保留原名与返回类型，内部委托插件方法，前端调用名不变；P4 再切 `invokePlugin` 并删包装。
- 用户已于 2026-11-17 授权：本机安装 rustup + stable 工具链、推送触发云端 CI、P3 的 DDL（`plugin_state`/`plugin_capabilities`）与产品版本 2.0.0（P3 前先跑 `scripts/backup_db.ps1`）；连续执行至 P4。

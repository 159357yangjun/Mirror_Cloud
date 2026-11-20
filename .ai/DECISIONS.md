# DECISIONS

当前更新签名、正式发布与插件前三项实施均已有用户授权，无待重复批准事项。按已定范围收口，不加入社区索引或 WASM。更高版本签名下载/安装和插件原生 UI 实测缺口如实保留，不因等待用户交互而扩大结论。长期规则见 AGENTS.md。

## 2026-11-20 — P2：portable-migration 迁移（零宿主依赖）

- 该组整体迁入 `crates/plugins/portable-migration`，不引入任何注入 trait：它只依赖 `StorageRepository`/`AssetRepository`/`AssetStagingRepository`/`StorageGroupRepository`/`WorkflowRepository`，无 `AppHandle`、无 `TaskEngine`、无网络。为没有耦合的地方硬造 trait 只会增加误用面。
- 四个纯读命令补 Tauri `State` 参数：`inspect_*` 系列原本不需要状态，但薄包装要经内核分发，必须拿到 `kernel`。Tauri 的 `State` 由框架注入、前端不传，因此命令名与参数契约对前端不变；这比给插件加一套「无状态单例」入口更简单，也避免同一逻辑出现两条调用路径。
- `PortableBatchDecisionItem` 补 `Serialize`：它只在入参位置出现，插件侧原本只需 `Deserialize`；内核薄包装用 `json!` 组装载荷，需要它可序列化。加 derive 不改线上字段。
- 契约类型改由插件模块 `pub use` 再导出（`#[allow(unused_imports)]`）：`commands.rs` 里已有 `pub use portable_*::*;`，前端与 CLI 通过这些名字引用视图类型。把类型定义搬到插件后继续从命令模块导出，可在不触碰任何调用方的前提下完成迁移；`allow` 只是压制「再导出未被本 crate 使用」的提示，不是放宽检查。


## 2026-11-19 — P2：cloud-browser 迁移与宿主依赖注入

- 插件不依赖 tauri：`cloud-browser` 插件 crate 只依赖应用/领域/持久化/provider 注册表等非 UI crate，宿主侧依赖一律经注入 trait 进入——`TaskEventSink::emit_task` 替代 `emit_task`、`GalleryDeleteRunner::run_gallery_delete` 替代 `run_gallery_delete_plugins`。若让插件直接持有 `AppHandle`/`AppState`，插件边界即失真，也无法在无 UI 环境（CLI/SDK）复用与测试。
- 后台批量改用 `TaskEngine::create` + `tokio::spawn`：原 `spawn_cloud_batch_task` 依赖 `tauri::async_runtime::spawn`，留在插件会破坏可测试性；任务事件出口改由 `TaskEventSink` 注入，宿主用包了 `AppHandle` 的实现发 `task://updated`。
- `retry_task` 留在内核：其职责是任务状态校验与重排队（kind/status/attempt/requeue），属任务队列能力；重跑动作本身委托插件的 `cloud.respawn_batch_task`，单一实现，不复制逻辑。
- 内核视图类型补 `Deserialize`、`PrivateImagePreview.mime_type` 由 `&'static str` 改 `String`：薄包装需要 JSON↔Rust 类型双向转换，Serde 不能从 owned JSON 反序列化借用的 `&'static str`；改 owned 类型不改变线上 JSON 结构，前端契约不变。
- 门禁随源码搬位，不放宽：`check_user_flow.py` 的 10 条 cloud 断言（cloud delete/move 的 Deployment 状态、应用核心委托、批量边界与模板、gallery-delete 钩子、持久化任务 kind、批处理协作停止）改指向 `crates/plugins/cloud-browser/src/lib.rs`，条件与标签保持，未删任何断言。
- 验证口径：本机 gnu 工具链可跑 `cargo check --workspace --tests` 与各插件 crate 单测；MSVC 专有二进制测试仍交云端 CI，不写成已验。

## 2026-11-19 — P2：reconcile 迁移与共享扫描 crate

- 迁移边界：reconcile 组 4 条命令进 `crates/plugins/reconcile`；依赖从 `&AppState` 改为 `SweepDeps<'a>{assets,storages,journal,settings,credentials,registry}`，插件不再持有宿主状态类型，编译期即可看出越界。
- `sync_one_storage` 归属：命令映射表把它算在 `cloud-browser` 组，但 reconcile 的 `refresh_stale_indexes` 也要用它，故抽成共享 crate `crates/remote-index`（内核命令与 reconcile 插件共用），而不是塞进 reconcile 插件形成反向依赖。
- 后台定时器移交插件：`ReconcilePlugin::start_background(self: Arc<Self>)` 自持循环，宿主 `lib.rs` 只注册实例并调用一次；`commands::reconcile::start_background_reconciler` 删除。理由：定时行为是插件能力，留在宿主会让插件禁用后仍有后台流量。
- `provider_registry()` 返回 `Arc<ProviderRegistry>`：插件需在构造期拿到注册表构造 provider，返回 `&'static` 无法注入。
- 门禁随源码搬位，不放宽：`check_user_flow.py` 的 30 余条 reconcile/remote-index 断言改指向 `crates/plugins/reconcile/src/{sweep,cadence,lib}.rs` 与 `crates/remote-index/src/lib.rs`，并用 `pub async fn run_sweep_inner(`/`pub fn sweep_summary(`/`deps: &SweepDeps` 等新签名替换旧字面量。迁移中漏掉的两个既有测试已补回，未删任何断言。
- 验证口径：本机 gnu 工具链可做 `cargo check --workspace --tests` 与各 crate 单测；MSVC 专有二进制测试仍交云端 CI，不写成已验。

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
- 迁移方式：`PluginHost::register_override(instance)` 用真实实现替换同 id 占位实例，**清单唯一来源仍是内核装配表**；未知 id 报 `HostError::UnknownPlugin`，替换不改清单/开关/贡献点，避免插件自述清单漂移。
- 迁移期 Tauri 命令保留原名与返回类型，内部委托插件方法，前端调用名不变；P4 再切 `invokePlugin` 并删包装。
- 用户已于 2026-11-17 授权：本机安装 rustup + stable 工具链、推送触发云端 CI、P3 的 DDL（`plugin_state`/`plugin_capabilities`）与产品版本 2.0.0（P3 前先跑 `scripts/backup_db.ps1`）；连续执行至 P4。

## 2026-11-17 — P2 续：ai-assistant 迁移与静态门修复

- `ai-assistant` 迁移：设置读 `SettingsRepository`（键 `ai.provider`），`apiKey` 只进 OS 凭据库（`ai:provider`），历史明文键在读取时一次性迁移；`ai.plan_workflow` 仍走 OpenAI 兼容 `chat/completions`（`response_format=json_object`），失败映射 `invalid_payload`/`internal`。迁移期 Tauri 命令原名保留，仅委托插件。
- diagnostics 的 `appVersion` 改为**产品版本**：构造期注入 `env!("CARGO_PKG_VERSION")`（来自 `src-tauri`，1.4.16），不再使用插件 crate 自身的 `2.0.0-dev.1`，否则诊断输出与界面/更新器版本不一致。
- 指纹表修复：`scripts/check_user_flow.py` 的 CHANGELOG 表行停在 2576 行 / 188,327 字节 / `2aee04b0…`，而 HEAD blob 与磁盘均为 2583 行 / 189,008 字节 / `1d7221bb…`；该漂移在 `69ec25d` 就已存在（其 CI 43419429725 亦为 failure），非本轮引入。按表规则用 `scripts/fingerprint_rows.mjs` 的实测值更新表行，并把末列基线数改为 642。

## 2026-11-18 — P2 续：workflow 插件迁移

- 迁移策略：按 `docs/PLUGIN_COMMAND_MAP.md` 逐组搬移，`workflow` 组（6 条命令）是第二个真实插件。实现集中放在 `crates/plugins/workflow`，`apps/desktop/src-tauri` 命令只做边界转换（序列化入参 → `kernel.invoke("workflow", "workflow.<method>", payload)` → `serde_json::from_value` 还原），**逻辑单份**，不保留双实现。
- 组合逻辑归属：内置配方目录、`workflow_from_fields`、`workflow_view` 的 camelCase 映射随实现迁入插件；命令层仅保留默认管线维护所需的前导逻辑（`list_workflows` 的 `resolve_default_publish_target`/`sync_system_default_pipeline`），与原行为一致。
- 依赖方向：插件 crate 允许依赖 `domain`/`persistence-sqlite`（插件持有仓储句柄，构造期注入），但仍不依赖 Tauri/`src-tauri`；`check_kernel_deps.py` 守卫的仍是三个内核 crate。
- 前端与命令名不变：`list_recipes`/`create_workflow_from_recipe`/`create_custom_workflow`/`list_workflows`/`set_default_workflow`/`delete_workflow` 的入参（camelCase）与返回结构保持原样，P4 才收敛到 `invokePlugin`。
- 编译验证口径（当时）：本机无 MSVC 链接器，gnu 目标工具链（`1.98.1-x86_64-pc-windows-gnu`）安装未完成（`missing manifest in toolchain`），本地 `cargo check` 无法执行（U）；插件代码正确性由云端 CI 的 `Rust check`/`Rust tests` 判定，不本地伪造成功。（后续同日已装好 gnu 工具链并补 MinGW PATH，见下节，本条口径已更新。）

## 2026-11-18 — P2 续：publish-strategy 插件迁移与本地编译通道

- 迁移策略：`publish-strategy` 组 4 条命令中，`create_storage_group`/`list_storage_groups`/`delete_storage_group` 迁入新插件 crate `crates/plugins/publish-strategy`，命令层改薄包装，委托 `publishStrategy.create_group` / `publishStrategy.list_groups` / `publishStrategy.delete_group`；群组校验（名称、strategy 枚举、≥2 成员、唯一存储、单 primary、存在且 enabled）与私有 R2/S3 混组拒绝随实现迁入插件，**逻辑单份**。
- 边界归属：`delete_storage_group` 的默认目标守卫、`sync_system_default_pipeline`、`cleanup_legacy_workflows_referencing_target` 属系统默认管线职责，留在内核命令层先做，再委托插件删除；`repair_asset` 依赖 provider 工厂与 `tauri::AppHandle` 任务事件（`emit_task`），暂留内核，待 P3 抽出 provider factory 后再迁（插件源码已注释说明）。
- 依赖方向：插件 crate 依赖 `kernel-api`/`persistence-sqlite`/`serde_json`/`uuid`/`async-trait`，仍不依赖 Tauri/`src-tauri`；`StorageRecord` 新增字段 `capabilities_json` 需在测试构造中补齐（`crates/persistence-sqlite/src/lib.rs:42-54`）。
- 本地编译通道：`1.98.1-x86_64-pc-windows-gnu` 工具链安装完成（rustup 自愈半装状态），配合 `D:\mingw64\mingw64\bin` 的 gcc 加入 PATH，`RUSTUP_TOOLCHAIN='1.98.1-x86_64-pc-windows-gnu' cargo check -p plugin-publish-strategy -p plugin-workflow -p kernel -p plugin-host -p kernel-api --tests` 通过（exit 0）。此后插件代码可在本机静态验证，云端 CI 仍是构建与测试的最终判定。
- 工具链环境变量口径：所有 cargo 调用固定带 `RUSTUP_HOME=D:\rust\rustup`、`CARGO_HOME=D:\rust\cargo`、`RUSTUP_TOOLCHAIN='1.98.1-x86_64-pc-windows-gnu'`（stable-msvc 已损坏，禁用）。

## 2026-11-18 — P2 续：provider 工厂抽取为注册表 + provider 插件

- 抽取方式：新建 `crates/provider-registry`（`ProviderConstructor` trait + `ProviderRegistry` 按键查表），`github`/`gitee`/`oss`/`cos`/`webdav` 的构造代码迁入 `crates/plugins/provider-github`、`provider-gitee`、`provider-opendal-extra` 三个内置插件；宿主保留 `r2`/`s3` 兜底（`provider_factory::BuiltinS3Constructor`）。
- 接口约束：`CredentialReader::read_json` 返回 `serde_json::Value` 而非泛型 `T`——泛型方法使 trait 失去 dyn 兼容性，而注册表需持有 `&dyn CredentialReader`；类型化解析上移到调用方（各构造器与 `BuiltinS3Constructor`），行为与迁移前一致。
- 兼容承诺：`provider_factory::build_provider` 签名与两处用户可见错误文案不变，`commands.rs`（"is not wired in this build"）与 `cli.rs`（"is not supported by the Typora bridge"）的调用点不动；`ProviderRegistry::build` 的 `unsupported` 回调由 `Fn(&str)` 放宽为 `FnOnce(&str)`，以承接 `build_provider` 的 `FnOnce` 签名。
- 插件边界：三个 provider 插件不暴露 IPC 命令（`plugin_invoke` 返回 `unknown_method`），能力经 `ProviderRegistry` 提供给宿主；其 `manifest` 复用装配表已声明的 `provider.*` 贡献，经 `register_override` 注册进 kernel。
- 验证口径：本机 `cargo check --workspace --tests` 与 `cargo test`（provider/workflow/publish-strategy/kernel/plugin-host 共 30 项）通过；`cargo test -p image-hosting-platform-desktop provider_factory` 因 gnu 工具链链接的测试二进制在本机加载失败（`STATUS_ENTRYPOINT_NOT_FOUND`）无法运行，交云端 CI（MSVC）判定。



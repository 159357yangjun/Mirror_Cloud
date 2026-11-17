# ADR 0005 — 插件调用契约改为异步

- 状态：Accepted（2026-11-17）
- 相关：ADR 0002（manifest v2）、ADR 0003（命令分发）、`crates/kernel-api`、`crates/plugin-host`、`crates/kernel`
- 触发：P2 迁移 `diagnostics` 时发现插件必须读取数据库（`storages.list().await`、`tasks.list().await`）

## 背景

P1 的宿主契约是同步的：

```rust
pub trait BuiltinPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifestV2;
    fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure>;
}
```

而真实插件的第一批方法（诊断、工作流、云端浏览、迁移）全部依赖异步仓储与网络：

- `StorageRepository::list()`、`TaskEngine::list()`、`PluginRepository::list()` 都是 `async fn`；
- 云浏览/迁移还要走 `reqwest` 与文件 IO。

同步签名只有两种实现方式，都不可接受：

1. 在命令线程里 `block_on` —— Tauri 命令已运行在 tokio 上，嵌套 `block_on` 会 panic 或死锁；
2. 把异步工作丢到别的线程再同步等待 —— 引入额外线程与超时语义，且违背「插件方法自行 await」的目标。

## 决策

### 1. 契约为异步

```rust
#[async_trait]
pub trait BuiltinPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifestV2;
    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure>;
}
```

- `kernel-api` 增加 `async-trait` 依赖（纯宏展开，无运行时依赖，仍不依赖 Tauri/SQLite）；
- `PluginHost::invoke` 与 `Kernel::invoke` 改为 `async fn`，内部直接 `plugin.invoke(..).await`；
- 错误码集合不变（`disabled | unknown_plugin | unknown_method | permission_denied | invalid_payload | timeout | internal`）。

### 2. 内核锁换成 tokio 锁

`AppState.kernel` 由 `Arc<std::sync::RwLock<Kernel>>` 改为 `Arc<tokio::sync::RwLock<Kernel>>`：

- `plugin_invoke` 是 `async` 命令，`std::sync::RwLockReadGuard` 不是 `Send`，跨 `await` 会编译失败；
- tokio `RwLock` 的守卫可跨 `await`，且没有锁中毒分支（原先的 `Internal` poisoning 错误随之删除）。

### 3. 插件仍不接收 context 参数

服务句柄（仓储、`CredentialStore`、`data_dir`、`AtomicBool` 状态）在**构造期**注入插件实例：

```rust
let diagnostics = DiagnosticsPlugin::new(
    storages.clone(), plugins.clone(), tasks.clone(), workflows.clone(),
    data_dir.clone(), local_api_running.clone(),
);
kernel.register_override(Arc::new(diagnostics))?;
```

理由：`SqlitePool` 及其仓储 clone 廉价；注入比每次调用传 `&dyn Services` 更简单、更快，且让 `kernel-api` 保持零业务依赖。插件 crate 允许直接依赖 `persistence-sqlite` / `domain`（用户已确认）。

### 4. 插件实现约束

- 禁止在插件方法内对当前运行时 `block_on`；需要并发时用 `futures::future::join`/`join_all`；
- 单个插件方法仍受 `plugin_invoke` 的 30s 默认超时约束（超时由前端/宿主层处理，插件应自行避免长阻塞）；
- 同步逻辑保持同步，只在真正 IO 处 `await`。

## 后果

- **正面**：插件方法可直接读写数据库与网络，不需要线程桥；`plugin_invoke` 全链路无序列化/线程切换；契约测试可用 `#[tokio::test]` 直接驱动。
- **代价**：`plugin-host`/`kernel` 的测试需要 `tokio` dev-dependency（`rt-multi-thread`、`macros`）；插件实现必须 `#[async_trait]`。
- **兼容**：v1 内置插件全部编译期链接，无外部 ABI，故不构成破坏性变更；`plugin_invoke` 的 wire 形状（参数/错误码）不变。
- **CI**：仓库 `rust-toolchain.toml` 固定 `1.98.1` + `rustfmt`/`clippy`，本 ADR 不改变工具链。

## 验证

- `cargo check -p kernel-api -p plugin-host -p kernel --tests` 通过；
- `cargo test -p kernel-api -p plugin-host -p kernel`（云端 CI，MSVC 链接器）覆盖 7 + 4 + 6 个用例；
- `npx tsc -b` 不受影响（前端未改）。

# Multi-cloud Publisher v1.3.1 Actual Validation — 2026-09-23

验证对象：`multicloud-publisher-v1.3.1` 源码树。

## 本环境真实执行并通过

- `python scripts/check_contracts.py`
  - frontend invokes: **49**
  - Rust Tauri commands: **49**
  - Tauri registrations: **49**
  - 校验器已支持递归扫描 `commands/**/*.rs`，因此模块拆分不会造成假阴性。
- `python scripts/check_user_flow.py`
  - 基础用户闭环：22
  - 可靠性 / Permission Gate：累计 40
  - v1.2.5 一致性与完整性：累计 60
  - v1.3 Publisher Core / Publish Center / Cloud Manager：累计 69
  - v1.3.1 Integration Layer / background / performance：累计 **79 / 79**
- `python scripts/validate.py`
  - JSON / TOML 解析：通过
  - SQLite migrations `0001–0010`：可按顺序在空数据库执行
  - 创建业务表：11
  - Cargo workspace member 路径：完整
- `python -m compileall scripts`：通过。
- 使用系统全局 TypeScript 5.8.3 对 `apps/desktop/src` 的 **23 个 TS/TSX 非声明文件**执行 `transpileModule` 语法转译：通过。

## v1.3.1 重点代码复核

1. Local HTTP API 使用 `TcpListener::bind("127.0.0.1:36677")` 等价的 loopback 地址构造，不监听 LAN / 公网。
2. `/v1/upload` 与 `/v1/upload-paths` 都要求 `Authorization: Bearer <token>`。
3. Local API Token 由 OS Credential Store 保存；设置页轮换 Token 后，运行中的 HTTP handler 读取同一个 `Arc<RwLock<String>>`，旧 Token 立即失效。
4. HTTP 原始 body 限制为 32 MB；path batch 限制 1–100 个路径。
5. Local API 两种上传路径都复用 `cli::upload_with_default_workflow`，继续走默认 Workflow / 多云 / 插件 / 任务 / 资源持久化链路。
6. Tauri Tray 已接入：左键恢复窗口，菜单可显式打开或退出。
7. 主窗口 CloseRequested 会 `prevent_close + hide`，后台 API 继续工作；退出由 Tray 菜单负责。
8. Typora / Local API / Output integration commands 已从原单文件 `commands.rs` 迁移到 `commands/integrations.rs`，开始拆分 command layer。
9. Desktop workflow publish 与 CLI/Typora publish 的图片 decode/resize/encode 调用均进入 `tokio::task::spawn_blocking`。
10. Settings 页面提供 Local API 运行状态、Base URL、Token 复制、Token 重置及调用示例。

## 本环境没有完成的验证

当前容器仍有以下硬限制：

- `cargo` / `rustc` 不存在，因此**没有执行**：
  - `cargo fmt --all -- --check`
  - `cargo check --workspace --locked`
  - `cargo test --workspace --locked`
  - Tauri Rust 编译
- `apps/desktop/node_modules` 不存在，且 npm registry DNS 请求返回 `EAI_AGAIN`，因此**没有执行**：
  - `npm ci`
  - `npm run build`
  - Vite production bundle
  - Tauri bundle
- 完整 `tsc` 会因 React / Tauri / lucide / Zustand 等项目依赖未安装而出现模块缺失，因此这里只声明 dependency-free syntax transpile 通过，不声明完整 typecheck 通过。
- 没有执行 Windows EXE、Tray 真机事件、Close-to-Tray 真机行为或 Local HTTP socket 的 Windows 真实 E2E。
- 没有执行 Typora / Local API → GitHub/Gitee/R2/S3/OSS/COS/WebDAV 的真实凭据上传。
- 当前环境无法从 registry 生成可信 `Cargo.lock` / `package-lock.json`，不会伪造 lockfile。

## 当前结论

**Source-flow / contract / migration / TS syntax validated; Rust build, dependency build and Windows integration E2E pending.**

v1.3.1 可以作为后续开发源码基线，但不能描述为“已完成真实 Windows 编译和系统集成验证的发行版”。

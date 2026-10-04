# Multi-cloud Publisher v1.3.4 Actual Validation — 2026-09-25

本报告只记录当前打包环境中**实际执行**的检查，不把源码扫描描述成真实运行测试。

## 已实际执行并通过

- JSON / TOML 解析：通过。
- SQLite migrations：`0001`–`0012` 在空 SQLite 数据库顺序执行通过；业务表仍为 11 张。
- 升级迁移模拟：先执行 `0001`–`0011`、插入 v1.3.3 官方 Webhook 记录，再执行 `0012`；Manifest 升级到 v1.2.0，新增 `before_process / after_process / on_publish_failure`，但 `enabled_hooks_json` 仍保持 `["after_upload"]`。
- Cargo workspace member 路径检查：通过。
- 前端 invoke / Rust `#[tauri::command]` / `generate_handler!` 注册契约：`63 / 63 / 63`。
- 用户流、可靠性、安全、Integration、Cloud Manager、Lifecycle、Application Core、Persistent Task 源码契约：`119 / 119`。
- TypeScript / TSX 非声明源码使用当前环境全局 TypeScript 做无依赖语法转译：`23 / 23`。
- Python validation/check 脚本可编译。
- Release SHA-256 文件清单覆盖 151 个源码/文档文件（不含清单自身），打包前重新生成并校验。

## v1.3.4 专项静态验证

- Plugin Runtime 定义并校验 `before_process / after_process / after_upload / on_publish_failure / on_gallery_delete / manual_trigger`。
- Desktop Workflow 与直接发布路径均接入处理前、处理后和失败 Hook。
- Typora / Local HTTP API CLI bridge 同样读取 `enabled_hooks_json` 并调用 `execute_for_hook`。
- 官方 Webhook 升级迁移只扩展 Manifest，不自动扩展用户已启用 Hook。
- `application::CloudMutationCore` 拥有目标冲突检查、原生 move、fallback copy/delete 与删除失败 rollback。
- fallback 上传会根据目标路径推断 Content-Type。
- Cloud Manager 批量删除 / 移动 / 改名新增持久化 Task 命令并注册到 Tauri。
- Task Center 能识别 `cloud_batch_delete / cloud_batch_move / cloud_batch_rename`。
- Cloud Manager UI 提交批量任务后立即释放页面，并主动刷新 Task query。
- 修正 CLI `PluginContext` 缺失 `metadata` 的结构不一致问题。

## 当前环境未执行 / 不声明通过

当前环境没有 Rust/Cargo toolchain，因此没有执行：

- `cargo fmt --all -- --check`
- `cargo check --workspace --locked`
- `cargo test --workspace --locked`
- Tauri Windows production bundle

npm registry 当前 DNS 解析失败，项目依赖没有完整安装，因此没有声明：

- `npm ci`
- 完整项目 TypeScript typecheck
- Vite production build
- `npm run tauri build`

还没有执行真实 Windows / 云端 E2E：

- 六类 Webhook 生命周期真实网络接收顺序与重试行为
- GitHub/Gitee/R2/OSS/COS/WebDAV 批量 Task 的真实网络执行
- 应用在批量 Task 中途退出后的 Windows 真机恢复表现
- 全局快捷键、Explorer 右键和 Tray 的真实系统交互

因此版本状态仍应描述为：**source-flow validated / Rust + Windows + provider E2E pending**。

# Multi-cloud Publisher v1.3.3 Actual Validation — 2026-09-24

本报告只记录当前打包环境中**实际执行**的检查。

## 已实际执行并通过

- JSON / TOML 解析：通过。
- SQLite migrations：`0001`–`0011` 在空 SQLite 数据库顺序执行通过；业务表仍为 11 张。
- 升级迁移模拟：先执行 `0001`–`0010`、插入旧插件记录，再执行 `0011`；旧插件保持 enabled，`enabled_hooks_json` 实际得到 `["after_upload"]`。
- Cargo workspace member 路径检查：通过。
- 前端 invoke / Rust `#[tauri::command]` / `generate_handler!` 注册契约：`60 / 60 / 60`。
- 用户流、可靠性、安全、Integration、Cloud Manager、Lifecycle 源码契约：`104 / 104`。
- TypeScript / TSX 非声明源码使用当前环境全局 TypeScript 做无依赖语法转译：`23 / 23`。
- Python validation/check 脚本可编译。
- Release SHA-256 文件清单：148 个源码/文档文件（不含清单自身）全部重新生成并在打包前校验。

## v1.3.3 专项静态验证

- `enabled_hooks_json` 独立于 Manifest 与 permission grants 持久化，旧数据默认仅 `after_upload`。
- Runtime 同时验证 Manifest 支持的 hook 与用户启用的 hook。
- `manual_trigger` 被关闭时，手动插件执行不会绕过 hook Gate。
- Cloud Manager 单删/批量删除接入 `on_gallery_delete` Host Runtime 事件。
- 批量移动与批量重命名单批上限 100。
- 批量移动/改名复用现有 move 安全策略与 Deployment 路径同步。
- 批量重命名模板生成结果拒绝路径穿越/目录分隔符。
- `commands/storage_entries.rs` 与 `commands/plugins.rs` 已从主 command 模块拆出，契约扫描仍覆盖嵌套模块。

## 当前环境未执行 / 不声明通过

当前环境未提供 Rust/Cargo toolchain，因此没有执行：

- `cargo fmt --all -- --check`
- `cargo check --workspace --locked`
- `cargo test --workspace --locked`
- Tauri Windows production bundle

项目 npm 依赖也没有完整安装，因此没有声明：

- 完整项目 TypeScript typecheck
- Vite production build
- `npm run tauri build`

还没有执行真实 Windows / 云端 E2E：

- 全局快捷键真实系统注册/冲突测试
- Explorer 注册表菜单安装与点击上传
- Tray 真实关闭/恢复/退出
- GitHub/Gitee/R2/OSS/COS/WebDAV 的批量 move/rename/delete 网络测试
- Webhook `on_gallery_delete` 真实网络接收测试

因此版本状态仍应描述为：**source-flow validated / Rust + Windows + provider E2E pending**。

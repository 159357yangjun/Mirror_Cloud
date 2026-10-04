# Multi-cloud Publisher v1.3.2 Actual Validation — 2026-09-23

验证对象：`multicloud-publisher-v1.3.2` 源码树。

## 本环境真实执行并通过

- `python scripts/validate.py`
  - JSON / TOML：通过
  - SQLite migrations `0001–0010`：空库顺序执行通过
  - 业务表：11
  - Cargo workspace member 路径：完整
- `python scripts/check_contracts.py`
  - frontend invokes：**57**
  - Rust Tauri commands：**57**
  - Tauri registrations：**57**
- `python scripts/check_user_flow.py`
  - 基础闭环：22
  - reliability / explicit permission：累计 40
  - integrity hardening：累计 60
  - v1.3 core / Publish Center / Cloud Manager：累计 69
  - v1.3.1 Integration Layer：累计 79
  - v1.3.2 zero-context + Cloud Manager mutation：累计 **93 / 93**
- `python -m compileall -q scripts`：通过。
- 使用当前环境全局 TypeScript compiler API 对 `apps/desktop/src` 的 **23 个非 `.d.ts` TS/TSX 源文件**执行 dependency-free `transpileModule`：**23 / 23**。
  - `vite-env.d.ts` 是声明文件，不属于输出转译对象，因此明确排除。

## v1.3.2 重点静态复核

1. Global Shortcut plugin 在 desktop startup 安装，默认 `CommandOrControl+Shift+U`。
2. Shortcut 调用同一 `cli::upload_with_default_workflow`，成功 URL 写回 clipboard。
3. Shortcut 设置持久化；关闭时调用 `unregister(GLOBAL_SHORTCUT)`，不是只隐藏 UI 开关。
4. Windows Explorer 菜单使用 HKCU current-user scope；命令对 executable/data-dir/`%1` 显式加引号。
5. `--shell-upload` 复用默认 Workflow，并在 Windows 成功后写 clipboard。
6. `StorageProvider` Port 暴露 move/create-dir；OpenDAL adapter 使用 native rename/create_dir。
7. Move 在写入前拒绝目标覆盖；fallback 使用 download → upload → delete，并在源删除失败时尝试回滚目标。
8. Move 成功后同步 Deployment remote path/public URL；batch delete 成功后同步 Deleted 状态。
9. Batch delete 单次限制 100 路径。
10. Gallery UI 有 create directory / rename / move / file selection / batch delete，并对 repository empty-directory 能力做限制提示。

## 当前环境没有完成的验证

当前容器没有 `cargo` / `rustc`，所以没有执行或宣称通过：

- `cargo fmt --all -- --check`
- `cargo check --workspace --locked`
- `cargo test --workspace --locked`
- Tauri Rust compile / Windows bundle

项目依赖未完整安装；本轮 `npm ping https://registry.npmjs.org/` 仍实际返回 `EAI_AGAIN` DNS 解析失败，因此没有执行 `npm ci`，也没有宣称完整 `tsc` / Vite production build 通过。dependency-free TypeScript 检查只证明语法可转译，不等于依赖解析和完整类型检查。

本环境也没有执行：

- Windows global shortcut 真实注册/冲突/注销 E2E；
- Windows Explorer registry 安装/点击上传 E2E；
- Tray 真实系统事件；
- Cloud Manager 对 GitHub/Gitee/R2/S3/OSS/COS/WebDAV 的真实 move/create/delete 网络测试；
- Typora / Shortcut / Shell / Local HTTP API → real Provider 的真实端到端上传。

## 当前结论

**Source-flow / contract / migration / dependency-free TS syntax validated; Rust build and Windows/network integration E2E pending.**

v1.3.2 可以作为后续源码基线，但不能描述为已经完成真实 Windows 编译与全部 Provider 真机写操作验证的正式二进制发行版。

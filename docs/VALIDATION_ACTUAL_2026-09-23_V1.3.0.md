# Multi-cloud Publisher v1.3.0 Actual Validation — 2026-09-23

验证对象：`multicloud-publisher-v1.3.0` 源码树。

## 本环境真实执行并通过

- `python scripts/check_contracts.py`
  - frontend invokes: **47**
  - Rust Tauri commands: **47**
  - Tauri registrations: **47**
- `python scripts/check_user_flow.py`
  - 基础用户闭环：22
  - 可靠性 / Permission Gate：累计 40
  - v1.2.5 一致性与完整性：累计 60
  - v1.3 Publisher Core / Publish Center / Cloud Manager：累计 **69 / 69**
- `python scripts/validate.py`
  - JSON / TOML 解析：通过
  - SQLite migrations `0001–0010`：可按顺序在空数据库执行
  - 创建业务表：11
  - Cargo workspace member 路径：完整
- `python -m compileall scripts`：通过；打包前删除生成的 `__pycache__` / `.pyc`。
- 使用系统全局 TypeScript 5.9 对 `apps/desktop/src` 做 `transpileModule` 语法转译：**23 个 TS/TSX 文件通过**。

## v1.3.0 重点代码复核

1. `application::PublisherCore` 持有 `mirror_all` 与 `primary_with_backups` 策略语义。
2. Desktop Storage Group 发布路径调用 `PublisherCore::publish_group`，不再在 Tauri command 里维护第二份 failover 算法。
3. 默认页面改为 Publish Center；文件拖拽、剪贴板、URL 最终仍打开同一个 `UploadDialog`，复用隐藏 Pipeline 和 Task Engine。
4. Publish Center 可切换默认 Storage / Storage Group，并直接修改已有 Output Preferences。
5. Gallery / Storage Browser 增加下载和确认删除。
6. `delete_storage_entry` 删除真实远端对象后，会查询同 `storage_id + remote_path` 的所有活动 Deployment 并标记为 `deleted`。
7. 旧版 v1.2.5 的 failover、唯一远端路径、Repair hash 验证、补偿删除、写权限探测与 Permission Gate 契约仍全部通过。

## 本环境没有完成的验证

当前容器：

- `cargo` / `rustc` 不存在，因此没有执行：
  - `cargo fmt --all -- --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - Tauri Rust 编译
- `apps/desktop/node_modules` 不存在，因此没有执行真实依赖环境下的：
  - `npm ci`
  - `npm run build`
  - Vite production bundle
  - Tauri bundle
- 直接运行完整 `tsc -p apps/desktop/tsconfig.app.json` 会因为 React/Tauri/lucide 等依赖未安装而报模块缺失；因此这里只把无依赖的 TypeScript 语法转译记录为通过，不把它写成完整类型检查通过。
- 没有执行 Windows EXE 启动、Tray/系统集成或 Typora → Publisher → Provider 的真实端到端测试。
- 没有对 GitHub/Gitee/R2/S3/OSS/COS/WebDAV 发起真实凭据网络集成测试。
- 当前离线源码仍不伪造 `Cargo.lock` / `package-lock.json`；正式联网 CI 负责解析依赖后执行 locked build，并应把成功生成的 lock 文件提交回源码基线。

## 当前结论

**Source-flow / contract / migration / TS syntax validated; Rust build and Windows E2E pending.**

v1.3.0 可以作为下一阶段源码开发基线，但不能描述为“已完成真实 Windows 编译与全 Provider 端到端验证的发行版”。

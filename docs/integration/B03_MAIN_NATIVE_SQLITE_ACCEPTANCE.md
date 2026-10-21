# B03 · main 原生 Windows / SQLite 验收整合

> 该文件记录来源与变更范围；真正的 PASS/HOLD 以本次提交 SHA 对应工作流完成后的结论为准，不表示正式安装发布或用户真机 G3。

## 基线

- 计划基于 main `6495d0791f729d1f353a6b188cf46fad527af827` 直接快进提交；绝不新建新分支、移动 tag 或修改 SQLite migration。
- 来自旧 `ci/ux34-native-smoke-20261011` 的 `.github/scripts/native_tauri_acceptance.ps1`（原 Blob `22df42078ab50dc75ae5d1dcdbe612d6173004fd`）。它曾服务冻结 #34，但复制旧 workflow 的固定分支和 1.4.9 校验不适合当前主线。

## 本批文件

- `.github/scripts/native_tauri_acceptance.ps1`（新增）：Windows GitHub-hosted runner 原生启动两次；观察真实顶层窗口和 SQLite 文件；进程重启后通过 SQLite `PRAGMA integrity_check` 及哨兵行检查保留结果；失败中止。测试拒绝使用已有的 APPDATA 配置目录，禁止触碰真实用户资料。将历史哨兵文案更换为 `native-main-ci`。
- `.github/workflows/taskui-native-windows-smoke.yml`（修改）：从旧 `ui/taskui-publish-first-pass-20261018` 改为 `main` 和受控文件变动 / 手动触发；版本以 package/tauri 一致性为准，不强制历史 1.4.9；在 NSIS/MSI 安装卸载前运行新增的原生重启/SQLite 验证，并保存日志 Artifact。
- `docs/integration/B03_MAIN_NATIVE_SQLITE_ACCEPTANCE.md`（新增）：完整来源、边界和 CI 归档。

## 边界

此测试是可销毁 Windows Runner 原生自动化，**不是** Windows 100%/125%/150% OS DPI、真实老用户数据库迁移、真实云端 Provider 权限的替代。CI 可能排队/失败，必须保留原始证据并按新 Commit 修复。不发布安装包、不访问 R2、不改变正式版本。

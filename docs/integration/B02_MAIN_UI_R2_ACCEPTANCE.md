# B02 · main Windows UI / R2 离线验收成果合入

> 本批只适配 Windows Edge 交互及 R2 离线测试。**不代表原生 Windows G3 或受保护 R2 live E2E 已通过**。以本批 SHA 的 GitHub Actions 结果单独裁决。

## 基线与来源

- main 修改前：`bb8808a75111a65e0f1df3d4e793acd6023c0470`，上批 B01 CI/TaskUI/Pages 全 SUCCESS。
- 旧键盘脚本来自 `ci/ux-browser-smoke-20261011` 的 `.github/scripts/ux_keyboard_smoke.mjs`（Blob `4dae3a96d0d29eb0ba3b653bed6cc453bf02a1a7`）；该分支附带的旧 CI 工作流仅适用于历史 #33，不能原样复制。
- DPI 方向来自 `qa/taskui-dpi-125-150-20261018`，其旧命令 `verify_dialog_interactions.mjs --dpr` 对当前主线测具无效，所以本批使用独立 CDP 真实 DPR 观察与 seven-page DOM 测量，不修改当前带有 fingerprint baseline 的主测试脚本。

## 变更范围与关键差异

1. `.github/workflows/taskui-ui-windows-acceptance.yml`：旧 `push: ui/taskui-publish-first-pass-20261018` 改为 `main` 及相关路径触发，支持 `workflow_dispatch`；在已有七页/确认/布局检查后执行独立真实浏览器键盘/DPR 测具并验证报告存在。
2. `.github/workflows/taskui-r2-guided-check.yml`：旧 R2 UI 分支触发改为 `main` 及相关路径触发，支持手动运行，明确拒绝非 main 来源，仍然仅运行离线 R2 验证。
3. `scripts/ux_keyboard_smoke.mjs`：恢复旧分支真实浏览器 Tab/Shift+Tab/Esc/焦点回归，并加入 1.25/1.5 DPR、640x480/1024x768 的七页测量。实际 DPR 与 CSS 视口必须符合期待；无浏览器、无法导航、横向溢出都会失败。该探针不会执行 Token 重置的确认操作。

## 风险/验收

- 当前候选不改变任何产品 Rust/TS/SQLite、Secret、更新器或 Release 配置。
- 既有 `scripts/verify_dialog_interactions.mjs` 和其 shape baseline 不被修改；避免未经证据签署测试基线。
- 所有新增 CI 必须针对本批新的完整提交 SHA 查看结论；如果失败，保留失败日志并修复，不能宣称成功。
- 浏览器 DPR 测试不等于 Windows 系统 DPI 与真实 Tauri 原生测试。当前 `taskui-native-windows-smoke.yml` 仍是旧分支专用，后续 B03 处理。
- 凭据不可进入报告；不提供真实 Provider API，R2 live 环境不被使用。

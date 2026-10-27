# 结构统一第一批实施计划

> 执行：按已确认设计在 main 上实施，不创建任务分支。独立文件可并行处理，提交与聚合检查串行；采用 test-driven-development 和 requesting-code-review。

**Goal:** 统一桌面事件订阅生命周期、云端对象纯计算和开发检查入口，以可执行用例证明行为边界。

**Architecture:** 保留 React/Tauri/Rust 框架与公开 IPC；新增小型平台模块和 cloud-browser 业务工具。页面继续持有业务操作、原查询键、轮询和默认时长。开发入口共享校验，缺依赖时明确停止。

**Tech Stack:** TypeScript、已有 TypeScript 编译器、Node 内置 assert、PowerShell、现有 npm/Vite 构建。

## Task 1：共享异步事件订阅

**Files:**
- Create: `apps/desktop/src/platform/desktop/subscription.ts`
- Create: `scripts/test_desktop_subscription.mjs`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/pages/TasksPage.tsx`
- Modify: `apps/desktop/src/components/UploadDialog.tsx`

- [ ] 先从真实 React 源文件提取事件 useEffect 的 AST，注入延迟完成的 Tauri listen 依赖，调用清理后再完成订阅。断言 unlisten 恰好执行一次，同时检查正常挂载会实际订阅、非 Tauri 不订阅。旧 App/Tasks 预计出现清理计数 0 的失败。
- [ ] 新增通用生命周期函数，契约如下；只接受订阅函数及可选的错误回调，不依赖 React、Query 或 toast：

```ts
type Unlisten = () => void
export function manageDesktopSubscription(
  subscribe: () => Promise<Unlisten>,
  onError?: (error: unknown) => void,
): Unlisten
```

实现要求：effect 结束后才得到 unlisten 时立即清理；正常订阅在 dispose 时清理；重复 dispose 不重复执行；同步抛错和异步拒绝均转交错误回调；dispose 后不通知页面错误。

- [ ] 三处 effect 返回共同函数产生的 cleanup，原事件名、业务 callback、queryKey、轮询与复制参数保留。错误回调只使用固定用户提示，不输出原始 SDK 错误。
- [ ] 增加共享函数的直接行为用例：正常/延迟清理、双清理、StrictMode 式卸载重订阅、同步/异步失败、卸载后失败。
- [ ] `node scripts/test_desktop_subscription.mjs`、前端 build 和现有 contract/user-flow 检查通过。若复现旧监听泄漏，在交付中单列其修复证据。

## Task 2：云端对象纯计算复用

**Files:**
- Create: `apps/desktop/src/features/cloud-browser/entryUtils.ts`
- Create: `scripts/test_cloud_browser_utils.mjs`
- Modify: `apps/desktop/src/pages/GalleryPage.tsx`
- Modify: `apps/desktop/src/components/StorageBrowserDialog.tsx`

- [ ] 对两处现有 parentPath 和图片识别的真实函数建立特征测试，冻结空根、连续斜线、目录、扩展名大小写、URL query、无 URL、非图片等输入输出。
- [ ] 先运行特征测试确认旧行为，再增加共享导出存在及实际调用集成检查，使尚未共享时明确失败；不能只用文本片段证明接线。
- [ ] 仅抽取相同的父路径和图片判定；图库 joinRemotePath、两处 sizeLabel、分享时长、布局与操作保持原样。不要把恰好 1 MiB 的 >=/> 差异顺手改掉。
- [ ] 页面和弹窗实际调用共享函数，避免保留死代码或仅为守卫留下字符串。
- [ ] `node scripts/test_cloud_browser_utils.mjs`、前端 build、contract/user-flow 检查通过。

## Task 3：统一显式开发入口

**Files:**
- Create: `scripts/desktop_dev.ps1`
- Create: `scripts/test_dev_entrypoints.ps1`
- Modify: `scripts/dev.ps1`
- Modify: `scripts/ui.ps1`

- [ ] 用临时隔离目录和假 npm 可执行入口，实际运行两个开发脚本：缺 node_modules 时必须失败且不调用 npm；不能安装真实依赖或启动真实服务。旧脚本会调用 npm install，测试应先失败。
- [ ] 提取共同的 Node/npm/依赖校验和工作目录管理。native 模式额外检查 Cargo 存在；存在不表示已验证 MSVC，文案不做过度承诺。
- [ ] 缺依赖时提示在桌面目录显式执行 npm ci，脚本本身不安装。正常模式分别只运行 npm run dev / npm run tauri dev；失败退出码保留，工作目录始终恢复。
- [ ] 测试 UI/native 参数、带空格目录、npm 非零退出、缺依赖零调用及无隐式安装。
- [ ] `pwsh -NoProfile -File scripts/test_dev_entrypoints.ps1` 通过。

## Task 4：统一纯函数检查入口与开发规范

**Files:**
- Create: `scripts/test_unit.mjs`
- Modify: `apps/desktop/package.json`
- Create: `docs/DEVELOPMENT_CONVENTIONS.md`
- Modify: `.ai/WORKLOG.md`

- [ ] 新增 Node 单入口，串行执行本批两个测试及现有 confirmation/probe/R2 离线诊断；某个子进程失败时返回非零，打印执行范围，不执行 mutation 或浏览器任务。
- [ ] package.json 新增 `test:unit` 和 `test:dev`；不新增依赖、不改变版本，不改 verify:all 与测具指纹。
- [ ] 规范明确 Query=后台缓存、Zustand=全局 UI、React state=表单/草稿；页面组合、feature 业务、platform 能力；命令与 repository 的既有边界继续沿用。
- [ ] 最终运行 test:unit、test:dev、build、validate、contracts、user-flow、docs contract 与 git diff --check。仅运行本批相关检查；已有主题基线失败仍如实记录，不重签。
- [ ] 独立复核全部差异，处理实际问题，再提交一批；逐提交报告写出完整 SHA/文件/验证及未推送无 CI。

## 完成后批次边界

第二批按已确认设计进一步拆分 desktop API、Settings 业务区域和查询约定，先处理静态守卫的真实实现定位，保持原安全覆盖。第三批收敛 Rust Provider/发布/插件/持久化；需要新 SHA 的 Rust 编译与测试证据，现有 MSVC 缺失不能解释为通过。

本计划不授权安装、真实云端写入、数据库结构变更、版本升级、推送或发布。

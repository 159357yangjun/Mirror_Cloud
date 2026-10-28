# 开发结构与框架使用约定

本约定实施已确认的结构统一设计；协作、授权和发布规则仍以根目录 AGENTS.md 为准。

## 框架职责

| 范围 | 当前框架/方法 | 使用边界 |
| --- | --- | --- |
| 桌面页面 | React + TypeScript + Vite + Tailwind | page 组合业务区域，feature 放业务计算/查询/局部组件 |
| 后台数据 | TanStack Query | 请求、缓存、轮询、mutation 后失效；查询键须包含区分结果的参数 |
| 全局 UI | Zustand | 页签、上传入口、toast、确认框，不复制后台列表缓存 |
| 局部草稿 | React state | 表单输入、选择、编辑状态；保存后依据后台结果确认 |
| 平台资源 | platform/desktop | 管理 Tauri 与浏览器能力，显式拥有订阅等资源的清理 |
| Rust | 现有 Cargo workspace | application 管策略，storage-core 管端口，具体 Provider 和 repository 各自实现 |
| 文档站 | Astro / Starlight | 独立静态文档产物，不并入桌面运行时 |

新模块按职责放置，不为凑层级预建空目录。现有代码分批迁移，公开命令、DTO、查询行为与安全边界通过测试冻结后再改。

## 当前共享边界

- `apps/desktop/src/platform/desktop/subscription.ts`：管理异步注册和迟到的 unlisten。React effect 返回 `manageDesktopSubscription` 的 cleanup；订阅失败由调用者提供固定、安全的用户提示。业务 callback 和缓存策略仍由所属页面负责。
- `apps/desktop/src/platform/desktop/dialogs.ts`：系统图片文件和下载路径选择，保留非桌面环境的空值回退及插件错误传播；业务调用方继续决定选择后的操作。
- `apps/desktop/src/features/cloud-browser/entryUtils.ts`：云端父路径和图片条目识别的纯计算。页面/弹窗复用实际实现，不复制函数体；目录操作、分享有效期和展示布局由各自业务负责。
- `apps/desktop/src/features/workflows/api.ts`：工作流和方案的领域操作；命令及浏览器回退沿用原行为。`platform/desktop/runtime.ts` 负责 Tauri 环境检测和调用。
- `apps/desktop/src/features/tasks/api.ts`：任务查询、取消和重试的领域操作；原 `desktop.ts` 接口保留兼容。
- `apps/desktop/src/features/assets/api.ts`：资产列表、修复和删除的领域调用；保留 `desktop.ts` 兼容入口，确认与刷新时序继续由页面负责，其他资产操作尚未迁移。
- `apps/desktop/src/features/settings/SystemDiagnosticsPanel.tsx`：系统诊断的纯展示组件；查询、刷新状态和回调仍由页面拥有，主题统计按实际页面及面板源码共同计量。
- `apps/desktop/src/lib/desktop.ts`：当前 IPC 兼容入口，后续按已确认方案分域迁移；不得在迁移时悄改命令名、参数或浏览器回退。
- `apps/desktop/src/pages`：继续保留现有页面路径；大页面逐步提取 feature panel/hook，不用旧文件中的死字符串维持静态检查。

## 开发启动

首次准备依赖或锁文件改变后，确认已获安装授权，再在 `apps/desktop` 显式运行 `npm ci`。启动脚本不会自动安装依赖或修改 lock。

```powershell
./scripts/ui.ps1    # 只启动浏览器界面
./scripts/dev.ps1   # 启动 Tauri 开发模式
```

两入口共享 `scripts/desktop_dev.ps1` 的环境/依赖校验、目录恢复和失败退出码。Tauri 入口检查 Cargo 存在；这不替代 MSVC、SDK、WebView2 等实际构建条件验证。

## 验证分层

在 `apps/desktop` 中运行：

```powershell
npm run test:unit   # 离线纯计算和订阅生命周期；不启动浏览器或云端
npm run test:dev    # 隔离目录、假 npm 下验证开发入口，不安装或启动产品
npm run build      # TypeScript 与 Vite 构建
```

其他已有入口：

- `python scripts/validate.py`：配置和内存库迁移校验。
- `python scripts/check_contracts.py`：前端调用、Rust command 和注册名称集合一致性，不证明所有参数和行为。
- `python scripts/check_user_flow.py`：既有安全与流程守卫；移动实现时同步明确其实际来源并保留覆盖。
- `cargo fmt --all -- --check`、`cargo check --workspace --locked`、`cargo test --workspace --locked`：Rust 各层验证，环境不足单独报告。
- `scripts/test_r2_wizard_browser.mjs`：真实组件与离线 IPC 的浏览器验证，需要本地 Vite 与浏览器；不等于 live R2。
- `npm run verify:all`：包含浏览器与会临时修改源码的 mutation；仅在干净、无并发写入的工作树上独占执行。

纯测试入口消费现有 Node 与已安装 TypeScript，不引入新测试框架。每个 suite 有明确退出码；缺文件、子进程失败和超时都使入口失败。新增测试用例可改变数量，验收要求是原契约与安全覆盖不丢失。

## 重构纪律

先写特征/失败用例，观察真实失败，再最小改实现。行为修复与纯结构迁移分别说明。两视图已有的分享时长、文件大小边界、错误提示或缓存差异，不因“统一”自动改掉。

不以重签测具基线、删除断言或保留无执行作用的旧字符串制造通过；不把 mock、Schema、DPR 或历史 SHA 的成功当作当前真实云端、原生 DPI 或发行验收。

# Mirror Cloud — R2 防呆向导与诊断第一批交付（2026-10-18）

> 本文是**实际修改记录**，不是功能已经正式发布的声明。
> 基线：`integration/mirror-cloud-taskui-postfreeze-20261018` 的 `3eca9cc8c51b696d3e1fc6d26d5d90853e75d3ab`。
> 目标：独立 UI Draft PR。不得合并原冻结候选、`main`、`dev`，不得更改版本号或开启真实 R2 live E2E。

## TaskUI G0：用户任务与恢复路径

| ID | 新手任务 | 可见完成条件 | 失败时应如何处理 |
|---|---|---|---|
| R2-T1 | 填写 Bucket + Account ID | 本地格式及默认辖区核对通过，看到派生的 S3 Endpoint | 原位置显示字段错误、解释桶名规则；保留其他输入 |
| R2-T2 | 区分公开发布与私有访问意图 | 明确选择用途；私有时不填写公开域名 | S3 API Endpoint 不可作为公开图片地址；私有不代表匿名读取已拒绝 |
| R2-T3 | 提供最小权限密钥 | 只在本次表单中输入；默认密码形式遮盖 | 鉴权与签名错误以固定模板显示，不回显 Secret、签名查询参数 |
| R2-T4 | 验证并创建连接 | 第 4 步授权后调用原有 Rust create 命令；完成后返回云端页 | 异步锁、错误分类、回到相关步骤；对未知错误不猜测根因 |

## TaskUI G1：任务驱动导航

- **Step 1 存储桶**：连接名称、Bucket、32 位 Account ID、默认辖区 Endpoint 预览；Region 仅允许 `auto`。
- **Step 2 用途**：公开访问地址（必须不是 S3 API Endpoint）与私有意图提示；迁移旧清单 `unknown` 时必须重新选择。
- **Step 3 密钥**：介绍目标桶范围的 Object Read & Write，两个密钥输入框均采用 password；资源目录可选。
- **Step 4 审核与保存**：只展示非敏感摘要、权限尚未验证状态；原有保存调用不会提前触发。不得无授权触发远端写入。
- **教程入口**：原帮助中心新增“R2 逐步配置与排错”指向「云端」；配置弹窗已有的本地教程已改写为准确的六步说明。

## 风险门禁：现有后端行为（重要）

`crates/storage-opendal/src/lib.rs` 的 `test_connection` 不是只读：`operator.check → write 临时对象 → stat → delete`。

本批 UI **没有修改** Rust、Provider 权限、数据库、云端测试工作流或任何凭据处理代码。

- 本地诊断 `validateR2Setup` 和 Endpoint 预览：无网络调用。
- 点击「授权测试并保存」前，必须通过现有 `confirmAction` 获得明确授权，文案写明写入/删除及残留风险。
- 临时对象写入属于已经存在的业务逻辑，而非本批新增自动测试。当前不提供虚假的「已验证私有」徽标。
- **暂不支持** EU / US / FedRAMP R2 辖区：Rust 当前强制合成默认域名，即使前端给出辖区 Endpoint 也不会使用。UI 拦截不支持的 Region，不伪造成功。

## G2：修改清单与逐 Commit 报告

| Commit | 文件（完整路径） | 修改前 → 修改后 | 影响及风险 |
|---|---|---|---|
| `69ff193` | `apps/desktop/src/lib/r2Diagnostics.ts` [新增] | 无本地细分诊断 → 离线字段校验、受控 Endpoint 预览、错误常量模板 | 不读取外部账户、无网络；不会把错误原文打印到 UI |
| `933e0ee` | `apps/desktop/src/components/R2GuidedFields.tsx` [新增] | 单页填写 → 四步配置、字段帮助、回到上一步、未验证状态 | 纯 React UI；不独立发起远端调用 |
| `6f28777` | `apps/desktop/src/components/StorageSetupDialog.tsx` [修改] | R2 与泛用 S3 同用一页，直接测试 → 独立 R2 向导 + 明确写入测试授权 + 错误脱敏分流 | 保留 S3/OSS/COS/GitHub/Gitee/WebDAV 原分支，R2 保存仍用原命令 |
| `914df88` | `scripts/test_r2_diagnostics.mjs` [新增] | 无测试 → 边界值、桶名、默认辖区、私有模式、公开 Endpoint 误用与密钥脱敏负例 | 只运行本地常量；禁止凭据外传 |
| `5abc083` | `apps/desktop/src/components/StorageSetupDialog.tsx` [修改] | 教程未披露真实写入 → 逐步解释远端测试与私有权限局限 | 修正文案，不改 Rust |
| `aabe786` | `.github/workflows/taskui-r2-guided-check.yml` [新增] | 无独立 R2 UI 检查 → Windows Runner 离线诊断测试 + 前端构建 + 锁文件检查 | 没有存储密钥，也不访问真实桶 |
| `db3aaa7` | `apps/desktop/src/components/HelpCenterDialog.tsx` [修改] | 只有一般教程 → 新增 R2 排错入口 | 引导至已有云端页，不创建假页面 |

后续若本分支出现修复提交，以 GitHub PR 的 `Commits` 和 `Files changed` 为完整实时明细；每次修复需单独说明原因，不能用本文已完成项代替新提交。

## 可验证关键代码差异（节选）

```diff
- if (isGenericS3) return createS3Storage({ ...s3Form, restoreGuard: ... })
+ // 仅 R2 走受控的四步 UI 和脱敏解释；
+ // 最终仍通过原 createS3Storage，不新增隐藏远端写入路径。
+ if (isGenericS3) return createS3Storage({ ...s3Form, restoreGuard: ... })
```

```diff
- {mutation.error && <div>{String(mutation.error)}</div>}
+ {r2Failure && <section role="alert">{r2Failure.title} …常量检查建议…</section>}
+ {mutation.error && !r2Failure && <div>…原非 R2 提示…</div>}
```

```diff
- <button onClick={() => void submitStorage()}>测试并保存</button>
+ // R2 仅在第四步显示，并且先经 confirmAction 明确批准临时写入测试。
+ <button onClick={() => void submitStorage()}>授权测试并保存</button>
```

## G3 验收矩阵（证据分层）

| 任务 | 静态/离线检查 | Windows 浏览器真实交互 | Windows 原生云服务 |
|---|---|---|---|
| Bucket 格式/Account ID/Endpoint | 独立单测 | 待覆盖完整四步键盘、640×480 | 不涉及网络 |
| 公开/私有意图区分 | 离线单测 | 待人工走查 | 真正匿名访问**未验** |
| API 错误脱敏 | 常量映射/敏感样例负例 | 待模拟失败提示 | 真实权限异常**未验** |
| 远端测试知情授权 | 源码检查及 TS 编译 | 待取消/确认弹窗走查 | **严禁无授权执行写入** |
| UI 嵌入与构建 | Windows CI | 尚无专门 4 步截图记录 | 尚未做新版本安装/升级 |

本次 UI 通过不等于真实 Cloudflare R2 写入成功、真实权限隔离、公开域名可用或正式发版。正式 R2 protected E2E 仍维持 HOLD。

## 下一批（未包含）

1. 先检查真实 Windows UI 的对话框焦点、Escape、Tab、640×480 与系统 DPI；必要时修复。
2. 如果确有需求，另提 Rust 的**只读独立探针**接口，不得把当前会写对象的 `test_connection` 假装成只读。
3. 独立设计 EU/US/FedRAMP 对应 Endpoint + Rust storage 配置，完成后需真实端到端验证。
4. 只有仓库所有者配置专用 R2 测试桶、最小权限凭据与受保护环境，才执行真实对象写入/私有 E2E。

## 本批增补提交（逐次记录）

| Commit | 文件 | 具体变化 | 验证门禁 |
|---|---|---|---|
| `6581801` | `docs/ui/TASKUI_R2_GUIDED_ACCEPTANCE_2026-10-18.md` [新增] | 写入 G0/G1/G2 证据、逐 Commit 文件清单和 G3 未验事项 | 文档审查；不代替真实测试 |
| `700c3d3` | `apps/desktop/src/components/StorageSetupDialog.tsx` [修改] | 删除只属于 S3 的分支中不可能进入的 R2 条件，解决 `TS2367` | Windows TypeScript + Vite 构建重新通过 |
| `cb8bfbc` | `apps/desktop/src/pages/StoragesPage.tsx` [修改] | 已保存 R2 的「测试连接」也弹写入同意框；成功只报告读写测试；失败不展示原始可能泄密的错误 | Windows 独立构建通过，真实远端写入未执行 |
| `d7fcaf7` | `apps/desktop/src/lib/r2Diagnostics.ts` [修改] | 迁移重复目标 `RESTORE_CONFLICT` 改为独立常量诊断，不误报为未知云端错误 | 纯离线诊断测试 |

> 每个 commit 的完整 diff 均保留在 Draft PR 的 **Commits** 页面。以上每项指向实际修改路径；后续修复继续单独添加记录，不在有未结门禁时宣称全部验收完成。

## 第二轮续做：2026-10-19 实际修改与证据（按 Commit 顺序）

本轮先读原始 CI 与源码，发现：R2 表单虽已将原始错误替换为固定诊断文案，`main.tsx` 的全局 MutationCache 仍会发送含原始错误的 Toast。因此先修泄密风险，再做真正的 UI 验收。下述 QA 桥接器为**仅在 Vite 测试页面运行的拒绝式模拟器**，无真实云端权限与写入。

| Commit SHA | 文件（增/改） | 修改前 → 修改后 | 影响和验证 |
|---|---|---|---|
| `2617bc1062f13769ab959e798f18fca445961ea3` | `apps/desktop/src/components/StorageSetupDialog.tsx`（改） | R2 虽有脱敏 `role=alert`，全局 MutationCache 仍可能弹出原始错误 → R2 mutation 自己处理固定诊断 Toast，阻止全局兜底显示原始 Provider 文本 | 错误 UI 与全局 Toast 双路径脱敏，**模拟含签名与密钥的错误测试已通过** |
| `da7a7bb227480b718ef2379820489361cd1b4490` | `apps/desktop/src/components/StorageSetupDialog.tsx`（改） | R2 配置窗没有正式 dialog/初始焦点/Escape/Tab 约束 → 新增 aria-modal、焦点陷阱、Esc 关闭、关闭后焦点恢复；确认框打开时由 ConfirmDialog 独占键盘 | Windows Edge 全流程已覆盖 Esc、Cancel、焦点回到入口与 Tab 正反环绕 |
| `0ad4dae7bad6167563f7e7161e35426eca6dfd04` | `apps/desktop/r2-wizard-qa.html`（增） | 无可独立加载的真实 R2 UI 测试入口 → 新增 Vite-only fixture HTML | 仅开发服务器访问；Tauri 常规构建不以此文件作为主入口 |
| `069e9bc8bcf7f12eafb3682d65b1c57b9509f5b1` | `apps/desktop/src/r2-wizard-qa.tsx`（增） | 无可信模拟桥接 → 挂载真实 React 向导、真实确认框、生产同款全局 Mutation 错误处理及**始终拒绝**的本地 Tauri invoke 模拟器 | 允许在不携带云密钥、无远端对象操作的条件下复现敏感错误 |
| `8c3fb8c249ca34dcefb5ef257f565a7a1b9f7959` | `scripts/test_r2_wizard_browser.mjs`（增） | 原离线 9 项规则测试不能证明真实 DOM/键盘/防误提交 → 新增 Windows Edge CDP 实际按钮输入、UI 截图、取消确认零调用、批准后模拟失败不泄密 | 真实 Chromium 执行；不替代 Cloudflare E2E |
| `5dfb81b266c936ec4eade0fe7d5fb350720d2800` | `.github/workflows/taskui-r2-guided-check.yml`（改） | 只有 TS 与离线测试 → 加 Windows Edge R2 交互和截图证据 Artifact | [#39181314625](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/39181314625)：**成功**，46/46 交互检查 |
| `7d12cb63092158b88dd5c597172c3ee306ea767b` | `apps/desktop/src/components/StorageSetupDialog.tsx`（改） | 失败面板在小窗较难找到、用户修改输入后旧错误仍保留 → 失败时滚动/聚焦诊断；字段修改时重置旧错误 | 下游浏览器 UI 验证：诊断聚焦及旧错误移除通过 |
| `6344cc3bb4e4898f37d24cf5bff9816edd5cd8ad` | `scripts/test_r2_wizard_browser.mjs`（改） | 只验 Esc/Cancel → 增加 Tab/Shift+Tab 双向环绕、640 容器边界、错误焦点及编辑后旧诊断清除 | [#39181650542](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/39181650542)：**成功**，2 场景 `checks=58 failed=0 cloud_writes=0` |
| `77c693b8bea1a702ada4381f33b836b17ad082b4` | `AGENTS.md`（改） | 逐 Commit 报告要求仅约定在对话里 → 固化为第 9 条仓库强制规则（完整文件路径、意图、前后变化、风险、证据、SHA 和 Diff） | 不更改产品运行逻辑 |
| `1cd7b12d8aa43e1fe8fb57b57e9161d04ec6e5ce` | `.github/workflows/taskui-r2-native-windows-smoke.yml`（增） | R2 PR 无实际 Tauri 候选构建与 Windows 安装检查 → 复用此前通过的原生窗口、NSIS/MSI 安装卸载和锁文件门禁，限此隔离分支 | 等待本提交对应 native 运行裁决；**不涉及真实 R2** |

### 第二轮关键代码差异（可审计节选）

```diff
- // 仅修改表单中的 mutation.error 显示，但全局 handler 仍会 notifyError(String(error))
+ onError: (error) => {
+   if (provider === 'r2') notifyError(diagnoseR2Failure(error).title)
+   // 防止全局 MutationCache 再弹出未脱敏的原始错误
+ }
```

```diff
- // R2 表单未标注 aria-modal，Escape / Tab 在窗口外也能游走
+ <section role="dialog" aria-modal="true" aria-labelledby="r2-dialog-title" ...>
+ // 绑定 Esc 关闭、Tab 焦点环绕；ConfirmDialog 打开时交由其优先处理
```

```diff
- // 失败后旧诊断保留，修正字段时可能误以为新配置仍失败
+ if (provider === 'r2' && mutation.error) mutation.reset()
+ // 首次失败时滚动并聚焦 R2 诊断面板
```

### 自动化现状与证明范围

- Windows Edge：1366×768 / DPR 1.0、640×480 / DPR 1.5 两套输入、键盘、授权流程，**58/58** 全通过；有提交前截图与脱敏诊断截图（QA artifact）。
- 原始离线 R2 配置/泄密负例：**9/9** 通过。浏览器模拟器**批准前零 invoke**，批准后仅记录一次本地被拒绝的 `create_s3_storage`，不是远端调用。
- 浏览器 DPR ≠ Windows 系统缩放：本轮还未在真实 Windows Tauri WebView 下逐步骤操作。Windows Native Smoke 仅用于确认打包、窗口启动、安装和卸载，不会证明 R2 真实写入或用户任务成功。
- 正式保护边界：没有请求/存储真实 R2 凭据、未解除 live E2E protected Environment、未打 tag/Release、未修改 `main`/`dev`/原始冻结候选。

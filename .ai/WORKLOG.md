# WORKLOG

## 2026-10-27 — 资产列表 API 领域化

**事实与动作**：在 `fa817d97233fb48277ae9291df94eae2001a82d1` 后，将只读资产列表迁至 `features/assets/api.ts`，原 `desktop.ts` 同名入口保留；资产修复、删除、预览和查询调用方未改。提交后的浏览器页面检查在 `fa817d9` 的源码工作区运行，7 个页面、36 项通过；浏览器缺少 Tauri 接口，不能证明原生数据功能。

**验证与限制**：迁移前测试 14 项中只有领域模块缺失与新委托未接线的 2 项按预期失败；迁移后实际加载完整兼容模块和领域模块的模拟 IPC 测试 25/0，覆盖浏览器/无 window 回退、默认和显式数量、返回值以及原生异常和模块加载失败。`npm run test:unit` 十一套、前端 build、`python scripts/check_contracts.py`（97/97/97）、`python scripts/check_user_flow.py`（639/0）和 `git diff --check` 通过；模拟测试不能证明真实 Tauri 或云端行为。

## 2026-10-27 — 任务查询键统一切片

**事实与动作**：在 `b5a26468e20f242d5ac9115f9e1c98c350639568` 后集中任务根键、按数量的列表键及发布页最近任务键；任务页面、上传弹窗、资源页及发布页的调用保留原键数组、轮询、事件更新及失效时机。图库的三个任务失效位置仍使用原字面量，保留现有流程守卫，尚未完成该处迁移。

**验证与限制**：工作区任务查询键测试 38/0，包含真实 TanStack QueryClient 的前缀失效和页面事件回调的局部缓存更新；`npm run test:unit` 十套、前端 build、`python scripts/check_contracts.py`（97/97/97）、`python scripts/check_user_flow.py`（639/0）和 `git diff --check` 通过。模拟事件及缓存不能代替真实 Tauri、云端和完整用户流程验证。

## 2026-10-27 — 任务 API 领域化

**事实与动作**：在 `098ec695707dcb757192cd60bb55e53b7c7b5a4a` 后，将任务列表、取消和重试操作迁入 `features/tasks/api.ts`，保留 `desktop.ts` 同名兼容函数。任务查询键、轮询及调用页面保持不变。

**验证与限制**：工作区先以旧实现运行测试，原行为通过，仅新领域模块缺失按预期失败；迁移后新旧入口的模拟 IPC 检查 22/0，覆盖列表默认及指定 limit、浏览器回退、取消/重试参数和错误传播。`npm run test:unit` 九套、前端 build、`python scripts/check_contracts.py`（97/97/97）、`python scripts/check_user_flow.py`（639/0）和 `git diff --check` 通过。模拟 IPC 不能证明真实 Tauri 运行时的行为。

## 2026-10-27 — 工作流查询键统一

**事实与动作**：在 `77a0c559a68f179f5d7313ea209d797948b4ec6c` 后，集中工作流与方案的查询键，并迁移七个页面或弹窗中的 11 个调用点；键值、查询选项、失效前缀和调用时机保留。其他业务域的查询规则尚待梳理。

**验证与限制**：工作区新测试在迁移前 22 项中只有共享模块及接线的 2 项预期失败，迁移后 22/0；实际 TanStack Query 客户端验证工作流前缀及子项失效、方案和任务缓存不受影响。`npm run test:unit` 八套、前端 build、`python scripts/check_contracts.py`（97/97/97）、`python scripts/check_user_flow.py`（639/0）和 `git diff --check` 通过。缓存客户端模拟不等于真实 Tauri 和云服务验收。

## 2026-10-27 — 设置页诊断展示组件

**事实与动作**：在 `da17aa79d11330fb248bb22a734446456b6cd2f5` 后，将系统诊断 JSX 提取为 `SettingsPage.tsx` 内的纯展示组件，查询和刷新仍由页面拥有。由于既有用户流程守卫和主题面统计按源文件读取，该切片暂未移动到独立文件；其余设置区域和领域化工作仍待实施。

**验证与限制**：对提取前旧 JSX 和提取后实际组件执行渲染/刷新测试，结构检查预期先失败，最终 9/0；工作区 `npm run test:unit` 七套、前端 build、`python scripts/check_user_flow.py`（639/0）及 `git diff --check` 通过。`node scripts/theme_face_inventory.mjs --verify` 在改动前后均失败，11 行与既有基线不一致，其中设置页实际 329/50/10、记录基线为 165/24/7；本轮未改守卫或基线。服务器端渲染不代表原生 WebView 或真实服务验收。

## 2026-10-27 — 前端 Workflow API 领域化

**事实与动作**：第一批本地提交为 `0a3648027dd51d7c6b38b0034030bdc9e8c5d385`。随后将六项工作流及方案操作迁入 `features/workflows/api.ts`，把原有 Tauri runtime 检测和 invoke 移至 `platform/desktop/runtime.ts`；`lib/desktop.ts` 保留同名兼容函数。工作流页面及设置弹窗改用领域入口，原查询键、失效规则、命令名与参数保持。此项仅是第二批的一个切片，其他领域、页面和查询规则仍待实施。

**验证与限制**：在第一批提交后的工作区先以旧实现运行行为测试，10 项中只有新模块缺失的 2 项按预期失败；迁移后模拟 IPC 检查 17/0，`npm run test:unit` 六套通过，`npm run build`、`python scripts/check_contracts.py`（97/97/97）、`python scripts/check_user_flow.py`（639/0）及 `git diff --check` 通过。模拟 IPC 不等于真实 Tauri 或云端验收。`cargo fmt --all -- --check` 通过；独立目标目录下的 `cargo check --locked --offline -p image-hosting-platform-desktop --lib` 因缺少 MSVC `link.exe` 在依赖构建脚本阶段失败，不能证明桌面 Rust 源码编译或测试通过。本轮未安装工具、推送或发布。

## 2026-10-27 — 代码结构统一第一批

**事实**：用户批准保留 React/Tauri/Rust 和现有接口及业务行为，分批统一共享方法、前端领域、Rust 服务。首批从 `9502431f8cf8fc50ef770061f08d84bbc10895bc` 的干净工作区开始；方案与计划在 `8c02604e454b2aaaef2965c64feef1712c207c1e` 提交。修改前远端 main 为 `5c79c42a04bfde72020329679bbb5dd4f961dbbd`。

**动作与判断**：提取异步桌面订阅释放逻辑，修复 App 和任务页面在卸载后才完成注册时的监听泄漏；云端浏览两处复用父路径及图片识别，同时保留原有显示和分享差异。开发启动入口共享环境检查，缺依赖时提示显式安装，不再自动安装。新增离线测试入口及框架职责说明。实际操作和真实 Tauri、云服务行为仍需后续验收。

**验证**：在上述方案提交之后的未提交产品工作区运行 `npm run test:unit`（5 套通过，订阅 13/0、云端浏览 61/0），`npm run test:dev`（Windows PowerShell 5.1，16/0；另以 PowerShell 7 测试同样 16/0）、`npm run build`、`python scripts/validate.py`、`python scripts/check_contracts.py`、`python scripts/check_user_flow.py`（639/0）、`python scripts/check_docs_site.py`（16 项）和 `python scripts/check_release_version.py` 均通过；`git diff --check` 通过。浏览器页面巡检 7 个页面、36 项通过，浏览器没有 Tauri 注入，数据请求出现 invoke 不可用提示，不能视为原生或真实数据验收。工作区测试不等于提交后同 SHA CI。Node 22.12–22.17 的类型剥离兼容处理已加入，但本机只在 Node 24 上运行，尚未在这些旧版本实测。未运行真实云服务、真实 Tauri 桌面集成或 Rust 测试，未推送或发布。

## 2026-10-25 — 协作规则集中与过期记录清理

**事实**：用户要求把 `.ai/` 中的详细规则整理到根目录 `AGENTS.md`，并直接删除过期内容。本轮从 `5a88d8579fb24a86e49a885d15feece40b3ef018` 开始，核对远端 main 为 `5c79c42a04bfde72020329679bbb5dd4f961dbbd`，工作区在修改前干净。

**判断**：长期规则应在一个入口维护；旧发布阶段、固定分支关系、工具链判断和候选版本不应继续充当现行指令。已删除过期状态、待办、决定和交接内容，保留检查脚本需要的文件入口；此前记录可通过 Git 历史追溯。

**动作**：AGENTS.md 集中规定 main-only、授权、证据、验证、凭据、发布、记录和交付要求；工具链改为按当前环境探测。产品源码、依赖、迁移、版本和工作流均不变；本轮不推送、不发布。生成快照和相关文档契约检查结果以本轮实际命令输出为准。

**验证**：`python scripts/validate.py`、`python scripts/check_user_flow.py`（639/0）、`python scripts/check_docs_site.py`（16 项）和 `git diff --check` 均通过；`python scripts/project_state.py --write` 成功生成本轮 main 来源快照，`--verify` 返回 problems=0，但远端 tag 对照因不可达而 SKIP，不能视为远端 tag 已复核。本轮仅改文档与生成快照，未运行产品构建、Rust 编译/测试、真实云端或安装器检查；本地提交未推送时无该提交的远端 CI。

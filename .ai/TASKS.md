# TASKS

## 进行中：插件化重构（Kernel + Plugins v1，P0/P1 完成，P2 进行中）

- 用户已批准边界与范围：内核保留发布闭环/宿主/存储 port+凭据+S3 兜底/任务队列/SQLite/基础 UI；14 个内置插件承接业务能力；v1 只做内置插件（默认启用、可禁用），第三方动态插件放 v2。
- P0 产物（已提交 `374de7f`）：`docs/PLUGIN_FIRST_ARCHITECTURE.md`、`docs/adr/0001`–`0004`、`docs/schemas/plugin-manifest-v2.schema.json`、`docs/PLUGIN_COMMAND_MAP.md`（99 条全量）、`scripts/backup_db.ps1`、`scripts/baseline_metrics.py`、`.ai/baseline/2026-11-16.md`。
- P0 核对：schema JSON 可解析；命令映射 99/99 覆盖；备份脚本语法通过；静态基线已采集（crate 11,513 行、src-tauri 14,195 行、前端 9,049 行、99 命令、98 处 `invoke(`）。
- 缺口：运行时性能基线（发布 p95/冷启动/RSS/安装包体积）待云端 CI；DDL 与 2.0.0 仍未授权；P0 未跑全量 `validate.py`/`check_user_flow.py`（无产品代码变更）。
- P1 产物（工作区，待提交）：`crates/kernel-api`（464 行）、`crates/plugin-host`（314 行）、`crates/kernel`（351 行）、`apps/desktop/src-tauri/src/commands/plugin_invoke.rs`、`apps/desktop/src/plugin-ui/{types,registry}.ts` + `PageHost.tsx`、`scripts/check_kernel_deps.py`、`scripts/check_plugin_contracts.py`；`AppState.kernel` 装配、handler 注册、14 插件种子（仅 `diagnostics.get` 真实可调）。
- P1 核对：`npx tsc -b` exit 0；`check_kernel_deps.py`、`check_plugin_contracts.py`（14 插件/14 贡献/9 贡献点）、`check_contracts.py`（前端 99 / Rust 100 / 注册 100）、`check_workflow_action_pins.py` 全通过；P1 静态基线 `.ai/baseline/2026-11-16-p1.md`（crate 12,642 行、src-tauri 14,232 行、前端 66 文件/9,139 行）。
- P1 缺口：本机无 Rust 工具链，新 crate 未编译（U，交云端 CI）；本机 Python 3.10 无 `tomllib`，`validate.py`/`check_tauri_dependency_family.py`/`check_release_version.py` 未跑；`check_user_flow.py` 640 条未跑。
- 下一步 P2（第 5–7 周）：按 `docs/PLUGIN_COMMAND_MAP.md` 把 61 条插件命令逐组迁入 `plugin-host`（每个插件实现 `BuiltinPlugin`），`check_contracts.py` 增加 `plugin_invoke` 双向对账；DDL 与 2.0.0 已于 2026-11-17 获授权（P3 前先跑 `scripts/backup_db.ps1`）。
- P2 进展（2026-11-18）：diagnostics、ai-assistant、workflow（`cba817a`）、publish-strategy（`7a1d0a2`）、provider 工厂抽取（`5c14940`：`crates/provider-registry` + provider-github/gitee/opendal-extra 三插件）已落地并推送。
- P2 进展（2026-11-19）：reconcile 已迁移——新增 `crates/remote-index`（共享扫描核心）与 `crates/plugins/reconcile`（`sweep.rs` + `cadence.rs` + `lib.rs`），命令层改薄包装，后台定时器移交 `ReconcilePlugin::start_background`，`src/reconcile_cadence.rs` 已删；`check_user_flow.py` 断言随源码搬位并补回两个漏移植测试。本机 `cargo check --workspace --tests` 与相关 crate 测试全绿，静态门全过。
- 剩余 P2：`cloud-browser`（14，扫描核心已在 `crates/remote-index`）、`portable-migration`（21）、`integrations-os`（9）、`image-transform`（1）。
- P2 进展（2026-11-17）：`BuiltinPlugin::invoke` 改 async（ADR 0005），`PluginHost::register_override` 支持占位实例替换；首个真实插件 `crates/plugins/diagnostics`（`diagnostics.get`）落地，`get_system_diagnostics` 改为委托 `plugin_invoke`；workspace members 加 `crates/plugins/*`、src-tauri 依赖 `plugin-diagnostics`。本机 rust 1.98.1 已装（`D:\rust`），但无 MSVC 链接器，`cargo check` 失败于 build script 链接（U，交云端 CI）。
- P2 待办：把 `validate.py`/`check_plugin_contracts.py` 纳入插件目录扫描；随后按映射表迁移 provider/publish-strategy/workflow 组。
- P2 续（2026-11-17）：`plugin-ai-assistant` 落地（`ai.get_settings`/`ai.save_settings`/`ai.plan_workflow`），`commands/plugins.rs` 三命令改为委托；workspace members 改为显式两条（`crates/plugins/ai-assistant`、`crates/plugins/diagnostics`，`validate.py` 不展开 glob）；diagnostics `appVersion` 注入产品版本；修复 `check_user_flow.py` 指纹表 pre-existing 漂移（2583/189,008/`1d7221bb…`）。
- P2 续验证（本机 py3.12）：`validate.py` OK、`check_contracts.py` OK（99/100/100）、`check_user_flow.py` 642/642 OK、`check_plugin_contracts.py` OK（14/14/9）、`check_kernel_deps.py` OK；`cargo check` 仍无法本机执行（无 MSVC 链接器），交云端 CI。
- P2 续（2026-11-18）：`workflow` 插件落地——`crates/plugins/workflow`（6 个方法，配方目录/`workflow_from_fields`/`workflow_view` 迁入插件）；`commands.rs` 六条 workflow 命令改薄包装委托 `kernel.invoke("workflow", …)`，删除已无人引用的 `RecipeDefinition`/`builtin_recipes`/`workflow_view`；`lib.rs` setup 注册 `WorkflowPlugin`；映射表补「P2 落地」小节。本机 `validate.py` OK、静态门全过（含插件 crate 扫描）；Rust 编译仍待云端 CI（gnu 工具链安装未完成，U）。


## 进行中：SignPath Foundation 开源代码签名

- 已推送公开隐私与代码签名政策草案，远端 CI `43391911032` 与 Docs Site `43391911079` 在源码 `ac49909915c0fb364b1a0ef46060943f87c24321` 成功。
- 本地正在将可选 SignPath 签名链接入发布工作流：先签应用 EXE，再由该 EXE 构建 NSIS/MSI，审批后签最终安装包，最后才生成 SHA256 与 Ed25519 更新清单；未来 Release Notes 加入政策链接。
- 已按 Cargo.lock 中650个 registry package entries 查询 crates.io 锁定版本元数据：582个 crate 名称、全部650条均找到 license 声明。发现 Rust `tiny-keccak 2.0.2` CC0-1.0 经构建期 proc-macro 依赖链到达；网站工具链还有2个 `mdn-data` CC0 项。`webpki-root-certs` 的 CDLA 声明在当前 rustls-platform-verifier 中仅用于 wasm32/dev，非 Windows x64 runtime 依赖的证据较强；仍需 SignPath 确认其 target/dev-only 成分范围。详见 `docs/CODE_SIGNING_LICENSE_INVENTORY.md`。
- 签名工作流的顺序已复核，但没有真正请求 SignPath 签名或验收 MSI 嵌套文件；MSI deep-signing artifact configuration 必须根据实际构建样本生成、审核后才可用。main CI 已在最新提交 `f2f84bc8011c72f5065be669b3ef90ae1c6b3e22` 成功。
- 发布工作流 GitHub `actions/attest` 已在 run `43406205980` 实际运行成功；六个最终候选文件均由 GitHub CLI `gh attestation verify` 验证通过，限定仓库、release.yml 签名工作流及 `refs/heads/main`。这是未启用 SignPath 的候选，不能替代 Authenticode 验收。临时 CLI/工件审查文件仍残留 `%TEMP%\mirror-cloud-attestation-43406205980`，删除操作被执行策略拒绝。
- 已准备 application answers draft 与锁文件许可证盘点报告；用户已提供联系人姓名/邮箱（仅供提交表单，不写入仓库）；仍需用户确认 GitHub MFA、SignPath MFA 和单人角色安排，以及 SignPath 对 CC0 / 单人职责的答复。
- 新增真实包证据：下载公开 v1.4.16 MSI 后用 Windows Installer 数据库只读检查；包内 File 表只有 `image-hosting-platform-desktop.exe`（1.4.16.0，43,947,008 bytes），MSI 大小 21,057,536 bytes，SHA256 `be757d7cfdd6a08220b4a618ee53f0ca73365c2c94df85d9e6de7ee986305dbc`。`D:\Mirror Cloud` 当前 EXE 的 Windows Authenticode 状态为 NotSigned。新增 `docs/SIGNPATH_MSI_ARTIFACT_CONFIGURATION.xml` 草案（根 ZIP 同时包含唯一 NSIS EXE 和 MSI；验证 MSI 内应用 EXE 后签 MSI）及应用 PE 元数据约束草案 `docs/SIGNPATH_APP_EXE_ARTIFACT_CONFIGURATION.xml`；均尚未上传/验证为 SignPath 配置。
- v1.4.16 既有 GitHub Release 正文已补并公开核实代码签名政策链接；尚未 SignPath 接纳前不加 SignPath 归属声明。
- 未完成：SignPath Foundation 申请/受理、单人维护角色确认、对 CC0/CDLA 依赖的处置或 SignPath 书面认定、NSIS/最终候选完整 SBOM 内容审查、SignPath 项目/策略/API token/上传并实测 Artifact Configuration、已签候选构建与 Authenticode 端到端验收。不可将 1.4.16 描述为 Authenticode 已签名。

## Typora 已有网图误报修复

- 已核实镜云已上传截图中的图片。随后 Typora 将同一网络 URL 交给本地文件上传入口，导致重复调用报错。
- 源码已区分网图和本地文件。网图按原顺序返回，本地文件沿用现有流程，右键上传仍走本地文件入口。三个 Rust 回归及打包程序的命令行验证通过。
- 已生成并验签 1.4.15 候选，源码 ed46b06004c3，构建 42460108963。用用户截图中的同一地址复现正式版退出1并验证候选退出0。候选已交付，待实际 Typora 界面验收。
- 用户要求正式发布并授权接手。1.4.16 同源码七项检查、签名候选及实际覆盖安装 G3 均通过。正式标签固定到已测源码，通过一次性恢复构建发布，六项公开资产及签名独立核验通过。当前本机是 1.4.16 候选，用户可直接安装同版本正式包。

## 已完成：第1批帮助入口与任务描述及候选G3

- 用户已回复执行第1批：统一帮助页面名称，设置入口显式选择分类，处理同页/同分类跳转后的旧滚动位置，清理过期待办描述。
- 已准备1.4.15无tag候选。官网演示、社区索引和WASM另排批次。
- 已完成：帮助路由/名称与过期描述修正、本地23组unit/640流程/99契约/build、同SHA七项G0及无tag候选41970382973签名/六资产/505源码/三锁独立核验；旧正式14的Typora错误分类已原生复现。
- 已完成：用户操作时批准后独立运行候选，原生9项帮助名称/分类/同页滚动/按钮可达与页面跳转通过；退出候选并恢复正式14，九表/原设置一致、assets7。
- 已完成：从D盘正式1.4.14覆盖安装1.4.15候选并重启。九张业务表与原设置保留，Gitee、外观和插件配置复验通过，帮助跳到快捷集成，CLI桥接上传一张合成图成功。
- 已完成：以已测源码发布正式1.4.15，公开签名资产独立核验通过。保留的正式1.4.14已完成应用内检查、验签、下载和安装，D目录正式程序哈希匹配。
- 已完成：重启正式1.4.15，核查九张业务表与原设置、帮助跳转及原Gitee目标的合成图上传。官网首页及更新教程已同步版本和正式下载链接，线上验收以Docs Site和公开访问收据为准。

## 已完成：教程同步与1.4.14

- 已授权执行：同步正式版本说明和插件/签名更新教程、部署网站；把现有缓存修正纳入1.4.14，完成同SHA检查、无tag签名候选、新G3及条件正式发布。
- 已完成：源码aa58f755推送、同SHA八项检查、网站实际部署/41浏览器检查与新教程HTTP200、无tag候选41822449820签名/六资产/504源码/三锁独立核验。
- 新G3已完成：实际候选运行/重启、九表与设置保留、Gitee CLI新上传、正式13真实缓存被候选14启动自动刷新。安装结束页观察边界见WORKLOG。
- 已完成：冻结源不可变v1.4.14、正式构建/公开发布及六资产/源码/三锁独立核验。
- 已完成：保留正式13客户端真实检查/验签/下载/应用内安装正式14、重启保真及CLI新上传；网站正式版本说明本次实际部署/41浏览器检查及HTTP200。
- 本机D目录现正式14，无候选标识；正式13副本与DPAPI备份保留。正式安装已获单独操作时授权并完成。社区索引/WASM不在本批范围。

## 上一批已完成：插件与1.4.13

- 插件前三项：本地Manifest安装、API/Schema兼容、自动配置表单；源码/云端与原生验收完成。
- 固定产品源60f0a34c898cf3ef88c470ff019381ef0fa476e5的G0/G2/G3及一次不可变v1.4.13正式G4/G5完成，公开六资产/签名/501源码/三锁独立核验通过。
- 用户批准后从保留的真实正式1.4.12程序执行检查/验签/下载/客户端安装并退出；D:/Mirror Cloud实际变为正式1.4.13并重启，九表及设置/插件保留，新Gitee上传与同版本签名复查通过。共用数据库/注册此前运行过候选，不能写成完全独立的干净旧版本机器。详见WORKLOG与会话outputs/formal-1.4.13-updater-e2e.json。

## 已随1.4.14发布的缓存修复

升级后旧检查缓存会保留旧版本和侧栏提示，已main修复按当前编译版本失效并同步手动检查提示；新增4项回归，22组unit/99契约/640流程/build通过。固定修复源14f4e58的六项同SHA云端检查全部成功；此修复已随正式1.4.14发布；旧60f源的正式1.4.13包不含此修复，旧tag保持不变。

## 保留与范围

历史合成Gitee测试对象、三个关闭本地样例插件和旧官方模板样本保留未删除；SQLite各阶段加密备份已恢复校验。旧1.4.10应用内安装失败与后续手动安装正式1.4.12、再从1.4.12真实签名更新成功分别记录。社区索引/WASM未实施；真实R2、Typora编辑器UI、个人MP4/壁纸字节和链接公开访问本轮未验。私钥异地备份未确认，未新增依赖/DDL/identifier或更换签名公钥。

## 插件化重构 P2（进行中，2026-11-18）

- 已完成并推送：`diagnostics`、`ai-assistant`、`workflow` 三个真实插件（`crates/plugins/*`），命令层薄包装委托 `kernel.invoke`，逻辑单份；`9735f50`（async 契约 + diagnostics）、`369c3bc`（ai-assistant + 静态门修复）、`74793b5`（契约脚本加插件 crate 扫描）、`cba817a`（workflow）。
- 已接线未提交：`publish-strategy`（群组 CRUD 3 条；`repair_asset` 暂留内核待 P3）；本地 `cargo check --workspace --tests` 通过（gnu 工具链）。
- 待办：P2 其余组（`reconcile` 4、`cloud-browser` 14、`portable-migration` 21、`integrations-os` 9）按映射表迁移；P3 provider 插件（github/gitee/opendal-extra）、DDL（plugin_state/plugin_capabilities）、版本 2.0.0；P4 前端 `invokePlugin` 收敛与内核命令收敛到 ≤30。
- 编译验证口径：本地 `cargo check --workspace --tests` 已可用（gnu 工具链 + MinGW gcc），`cargo test` 与打包仍以云端 CI 为准。
- P2 进展（2026-11-18，provider 工厂）：新建 `crates/provider-registry` 与三个 provider 插件（`provider-github`/`provider-gitee`/`provider-opendal-extra`），`provider_factory.rs` 改查表薄壳，宿主保留 `r2`/`s3` 兜底；`lib.rs` 注册三个插件实例，`build_provider` 签名与错误文案不变。本地 `cargo check --workspace --tests`、`cargo test`（30 项）通过；desktop 测试二进制因 gnu 链接加载失败，交云端 CI。
- 解锁：`reconcile`/`cloud-browser`/`repair_asset` 的迁移此前被 provider 构造阻塞，本轮后具备启动条件；下一步按映射表迁移 `reconcile`（4）与 `cloud-browser`（14）。

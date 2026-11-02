# 镜云现状核对与分批实施方案

日期：2026-11-02。审计基线：`cfd7d47e66ca6134c0106c6fb7f938466ca2c773`，其中运行代码与已构建的 `3a9b7b1efd37c3f67a8f9238daecf4c0be5fb00b` 相同。本文完成核验、方案和验收条件；新增产品功能尚未实施。

路径均以仓库根目录 `D:/image-hosting-platform` 为基准。各批是独立实施范围，选定批次后再细化为逐步施工清单。

## 结论与当前发布状态

保留 React / Tauri / Rust 桌面栈与 Astro / Starlight 网站，复用现有发布、存储和插件基础。优先修复真实行为与界面约定的偏差，再做展示和生态扩展。

本轮发现一项 **P1 发布阻断：Primary 成功时仍执行 Backup 上传**。已取消 [正式构建 41439806763](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/41439806763)，其发布作业未执行。不可变 `v1.4.10` 标签保留，指向 `3a9b7b1`，不删除、不移动、不用同标签发布另一份源码。修复后建议使用下一补丁版本 `1.4.11`，重新走无正式 tag 候选与验收。

此前候选的 CI、安装器检查和用户十项升级报告均保留为真实历史记录；新增策略缺陷使这些记录不足以支持当前源码正式发布，不能据此宣称产品整体无问题。

## 一、与来稿逐项对照

| 方向 | 已有实现与证据 | 缺口或需要修正的结论 |
| --- | --- | --- |
| 开源与仓库展示 | GitHub 仓库为 public，MIT 许可证，homepage 已指向现有 Pages | Topics API 实读为空；About 仍含 v1.4.6。README 无产品截图和直接下载入口，页面表仍是“发布/资源/云端/图库”等旧名称 |
| 官网与教程 | `website/package.json`：Astro 7.3.5、Starlight 0.42.4；`astro.config.mjs` 固定站点及 `/Mirror_Cloud` 基址；Docs Site 构建、浏览器检查与部署已具备 | 首页是教程目录。没有独立产品演示/下载页；没有 GSAP 或 reveal.js 依赖。已有导航和卡片过渡，不能说网站完全没有动效 |
| 字段教程 | `website/src/data/providerGuides.ts` 聚合七平台；`providers/types.ts` 已有来源、后台路径、填写值、示例、常见错误、直达链接等字段 | 可以复用；无需为官网演示重新维护一套配置教程。网站不收集账号、Token 或 Secret |
| 应用帮助 | `HelpCenterDialog.tsx` 已有离线步骤卡和在线教程链接；侧栏已改为上传/上传记录/云端配置/云端文件等清楚的文字入口 | 帮助卡仍使用旧菜单名；Typora 按钮只 `go('settings')`，AppShell 直接 `onNavigate={setPage}`，未设置 `integration` 分类。不是已完成的可跳过分步引导状态机 |
| 正式发布体系 | `release.yml` 手动构建候选，正式 v 标签生成 Release；恰好一个 EXE、一个 MSI，生成源码 ZIP、SHA256SUMS；安装卸载 smoke、锁文件检查已接通 | 本轮因新发现 P1 取消正式发布；无须增加 develop/Beta/Nightly 分支体系。正式标签不允许复用 |
| 更新器 | `commands/updater.rs` 使用 GitHub `releases/latest`；Rust 持有 PendingUpdate、受控目录、canonicalize、安装前磁盘重算 SHA256 | 当前为自定义更新器，并非已启用 Tauri 官方 updater 插件。依赖、配置与 release 工作流未见独立更新签名/Authenticode 接入；实际二进制签名状态需单独验件，不能凭宣传或文件名认定 |
| 插件执行基础 | `plugin-runtime` 有 template/webhook/ai_prompt 三种 kind、四种权限、六种 Hook、双层声明/授权、结构化 text/data 输出；宿主有启停、撤权、配置、执行日志 | 支持受控插件，不等于允许第三方代码执行。浏览器预览明确禁止真实插件/AI 查询，空列表不能证明桌面运行时没有插件 |
| 插件目录及安装 | `commands/plugins.rs:34` 固定三种官方 Manifest；`:246` 安装命令只接受目录里的 plugin_id；SQLite 已可保存 manifest/config/grants/hooks/source | 没有本地 Manifest 安装入口、远端社区索引、SDK 或 WASM 运行时。已有 examples JSON 不能直接当作可安装包 |
| 插件配置及契约 | Manifest 已有 `version`、`config_schema`；现有 PluginContext 是 asset_name/public_url/mime_type/metadata，PluginOutput 是 text/data | 插件版本不是宿主 API 兼容版本；未定义 apiVersion/schemaVersion。PluginView 不返回 config_schema，前端编辑的是原始 JSON，未自动渲染配置表单。来稿 JSON 是未来示意，不能当当前 API |
| 多云策略 | `crates/application/src/lib.rs` 统一调度；URL 选择明确让 Primary 优先、Backup 接管，Mirror 不接管主链接 | PrimaryWithBackups 执行与文档不符，详见下节。MirrorAll 的“全部尝试”与此问题分开处理 |
| 对账和修复 | `lib.rs:127` 启动后台任务；`commands/reconcile.rs` 有手动/周期同一 sweep、远端 exists、快照比较、事件和历史。默认关闭，启用后才产生后台请求 | `docs/RECONCILIATION_ENGINE.md` 中“未接 journal 写路径、无周期调度、无远端探测”等内容已过时。Desktop/CLI 已写发布/上传尝试/验证事件；不能继续把旧文档当现状 |
| 自动修复与可用性 | `repair_asset` 是用户触发的任务，从 online 副本下载并核对内容哈希后补回 failed/degraded 副本 | 后台 sweep 只报告差异、不删除、不重传、不改部署状态。没有已发布 URL 的自动访问故障切换服务；不能宣传“永不失效” |

以上属于源码及 GitHub API 核验，不是本轮对所有平台做了真实云端 E2E。未生成本地安装包、未安装 SDK/依赖、未操作用户真实数据库或图床。

## 二、P1：故障备份无条件执行

证据链：

1. `crates/application/src/lib.rs:68` 的契约、`StorageGroupDialog.tsx:110` 的提示及教程 `use/multicloud.mdx:13` 均规定：Mirror 始终同步，Backup 只在 Primary 失败时接管。
2. 同一核心文件 `:160` 的 backup_future 不读取 Primary 结果；`:179` 的 join3 同时驱动 Primary、Mirrors 和 Backups。
3. Desktop `commands.rs:2779` 起、CLI `cli.rs:932` 起均传入全部成员，没有外层条件门控。
4. 因此 Primary 成功时仍尝试第一个 Backup；Backup 失败还会继续尝试后续 Backup，直到一个成功或耗尽。主流程也要等待这条不必要的链完成。
5. 返回的 Backup 结果进入持久化；任一失败在桌面产生“部分云端失败”提示，混合状态可使资源变成 partial。CLI 同样计入警告。
6. **Backup 失败本身不会直接触发全量回滚。** 但入库失败等原有补偿场景会把多上传的成功对象也纳入回滚集合，扩大副作用和孤儿文件面。
7. application 当前两个测试只测 `select_public_url`，未调用 `publish_group`、未验证 Provider 上传次数。这解释了 CI 全绿仍能漏掉该边界。

独立子智能体已只读复核上述调用链并认定 P1。没有把推测的自动删除、数据丢失或已发生的云端事故写成事实。

## 三、实施顺序与每批交付

### 第 0 批：先修策略，再恢复发版

**范围：** `crates/application/src/lib.rs`；内存 Provider 测试可独立到 `crates/application/src/publish_tests.rs`；如测试宏需要，复用 workspace 的 async-trait 加入该 crate 的 dev-dependencies。必要的锁文件由 Cargo 更新。

步骤与验收：

- 先补调用级红灯用例：Primary 成功时所有 Backup 上传次数必须为 0，包括 Mirror 失败的场景。
- Primary 失败时按 priority 尝试 Backup，遇到第一个成功即停；未尝试成员不伪造 Failed outcome。
- Primary + Backup 构成一条有条件的执行链，与 Mirrors 并发。不能为了加条件先等所有 Mirrors，否则慢镜像会阻塞故障接管。
- 用可控制的内存 pending Mirror 证明：Primary 失败后 Backup 可开始，不需要等 Mirror 完成。无需真实网络、密钥或远端写入。
- 覆盖私有 Primary 上传成功但无 public_url 的情况：这不是上传失败，Backup 仍为 0；URL 选择不变。
- MirrorAll 仍尝试全部成员；所有 Backup 失败、无 Backup 等边界有明确 outcome 和警告。
- 云端运行 `cargo test -p application --locked`、全 workspace 测试、前端及 97 类命令契约检查；实际数量按新输出记录，不照抄历史总数。
- 对照 Desktop/CLI 的结果映射，确认未调用的 Backup 不进入部署失败数或补偿集合。
- 统一下一补丁版本的 Cargo workspace、Tauri、package.json、package-lock 和 Cargo.lock 工作区成员，使用现有版本一致性检查。
- 无正式 tag 出新候选；记录完整源码、EXE/MSI SHA256 和候选来源，再做真机升级矩阵及 Primary 成功/失败的策略验收。之后创建一次新的正式 tag；不移动 v1.4.10。

**完成标准：** 策略调用次数测试、集成结果、同 SHA 云端门禁与候选验收均有证据，才恢复正式发布。

### 第 1 批：纠正文档、导航和下载入口

**文件：** `README.md`、`docs/RECONCILIATION_ENGINE.md`、`apps/desktop/src/components/HelpCenterDialog.tsx`、`apps/desktop/src/components/AppShell.tsx`、`apps/desktop/src/features/settings/sections.ts`；仓库 About/Topics 为独立外部元数据。

- 统一当前页面名；帮助中的 Typora/Local API/更新入口应显式选择对应设置分类，避免落到上次停留的分类。
- 更新对账说明：哪些事件已写入、哪些请求会周期执行、默认关闭、哪些动作始终需要用户决定。
- README 顶部增加产品简介、真实版本截图、正式下载和教程入口；下载指向 `releases/latest`，候选产物单独标识。
- About 删除易过时的开发版本号。建议文案：“镜云 Mirror Cloud：面向 Windows 的多云图片上传与管理工具，支持图片处理、编辑器集成与受控插件。”
- 建议 Topics：image-hosting、image-uploader、tauri、rust、react、cloud-storage、multi-cloud、typora。当前未设置，本文也没有代为修改。
- 完善结构化发布证据：为候选单独上传小体积 provenance JSON/SHA256SUMS，包含源码、run/artifact、各资产大小和完整哈希，避免为了审计必须下载整个安装包归档；G3 仍需真实人工验收结果，不能由脚本自动填 PASS。

**验收：** 从帮助直达正确分类；旧菜单词不再误导操作；下载链接为实际正式版本；源码、候选和正式二进制分别留证。文档链接检查与现有用户流程检查保持原强度。

### 第 2 批：在现有网站增加产品演示

**建议复用：** Starlight splash 页、GuidePageFrame 的单张壁纸、现有顶栏和 Provider 数据。保留 `/Mirror_Cloud/guides/*`、`use/*`、`recipes/*` 的地址及应用 DOCS_BASE_URL。

网站继续上下布局：顶部为“首页 / 功能演示 / 配置教程 / 使用教程 / 下载”，图片处理收进使用教程；插件中心等本地安装闭环完成后再加入。保留现有 DeepSeek 壁纸为唯一全局背景，局部磨砂托住正文，避免重复贴图挡住内容。

**文件范围：** 修改 `website/src/content/docs/index.mdx`、`website/astro.config.mjs`、`website/src/components/GuideNavigation.astro`；新增 `website/src/content/docs/demo.mdx`、`website/src/content/docs/download.mdx`、`website/src/components/ProductDemo.astro`、`website/src/data/productDemo.ts`、`website/src/styles/demo.css`；扩展 `scripts/check_docs_site.py`、`scripts/check_docs_navigation.mjs` 的实际路由用例。

五个短场景：选择图片 → 图片处理 → 多云发布 → 副本状态与手动修复 → 复制链接/编辑器接入。场景中注明“演示数据”，不索取凭据、不调用用户图床。多云场景必须以第 0 批修正后的真实行为为基础；未实现的访问 URL 自动切换不演示成产品能力。

- 用户可滚动、点击下一步或直接选步骤；保留原生滚动和键盘操作。
- 手机采用纵向短步骤；关闭动画或禁用 JS 时文字与下载入口仍可用。
- `prefers-reduced-motion` 下去掉位移、缩放和自动播放；动效只改变背景/图形，文字保持清晰。
- 官网简短介绍能力，具体配置继续跳转已有字段教程；不重复堆砌长说明。
- 下载页来自真实已发布 Release 信息，不把候选或规划能力写成稳定版；API 不可达时提供可用的 Release 链接。

**技术选型比较：**

| 路线 | 取舍 | 建议 |
| --- | --- | --- |
| 现有 Astro + CSS/浏览器动画 API，独立演示页 | 改动小、保留教程地址；先验证交互结构 | 首选 |
| Astro + GSAP ScrollTrigger | 适合更复杂的连续时间线；增加依赖、清理及性能验证工作 | 原型确需复杂叙事时再采用 |
| 单独 reveal.js 幻灯片或重建官网 | 适合演讲；与现有产品导航和教程体验分离，维护更多 | 暂不作为主站架构 |

**验收：** `python scripts/check_docs_site.py`、网站 `npm run build`、`node scripts/check_docs_navigation.mjs`；覆盖 360/640/1280/1920 CSS 视口、键盘、减少动态效果、无 JS、旧教程链接和 404。不为本批自动安装网站依赖或更换框架。

### 第 3 批：本地声明式插件最小闭环

**复用边界：** kind 只允许现有三种；Host 执行，继续复用权限、Hook、凭据库和执行日志。StorageProvider 与编辑器接入保持各自接口。

**文件范围：** `crates/plugin-runtime/src/lib.rs`，可新增 `crates/plugin-runtime/src/manifest.rs` 并保留原类型重导出；`apps/desktop/src-tauri/src/commands/plugins.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/lib/desktop.ts`、`apps/desktop/src/types.ts`、`apps/desktop/src/pages/PluginsPage.tsx`；新增 `apps/desktop/src/features/plugins/PluginImportDialog.tsx`、`PluginSchemaForm.tsx` 与领域 `api.ts`；更新 `examples/plugins`、`docs/PLUGIN_ARCHITECTURE.md`。

- 先定义 Manifest schema/API 兼容版本；保留既有 text/data 输出和模板变量，来稿中的新 JSON envelope 另行设计适配。
- 文件输入以用户选取的 JSON 为来源，后端完整校验后预览 ID、版本、来源、Hook 与权限；保存时再次校验。首版建议上限 256 KiB，拒绝未知 kind/权限/Hook、保留的 official.* ID 和重复 ID，不静默覆盖。
- 新导入插件默认关闭，敏感能力需要显式授权；导入不能直接调用网络或执行插件。
- config_schema 通过受控 DTO 交给前端，只实现字符串、URL、布尔、数字和枚举等明确子集。密钥引用系统凭据库，不允许 Manifest 或普通配置 JSON 内嵌 API Key。
- 在开放导入前统一网络超时、响应体预算和错误脱敏。当前 Runtime 使用 Client::new()，Webhook 可把远端 body 放入错误；宿主主要做 1200 字截断。这里是需补测试的边界，本文未证明某次真实凭据已经泄漏。
- 为旧持久化 Manifest 定义兼容路径，不能把所有第三方未知版本都静默当旧官方版本。现有 JSON 字段足以支撑首版安装记录，先评估复用而非默认增加数据库迁移。

**验收：** 合法示例可导入且默认关闭；越权、重 ID、伪造官方 ID、未知 API、超大 JSON、失效配置均有明确错误；网络/密钥未授权不执行，撤权停用仍成立；真实上传链与手动 Hook 使用同一记录。测试先用内存和受控 HTTP fixture，不拿真实云端写入替代纯边界测试。

### 第 4 批：开发者文档与社区索引

- 发布实际契约、支持表、两个可安装示例、权限说明、调试与打包校验命令；SDK 先从类型/Schema/校验工具开始，不急于造独立大仓库。
- GitHub 静态索引记录来源、版本、兼容范围、权限、包地址与校验值；显示审核/维护状态，不把校验和叫做作者签名。
- 安装和升级均展示来源与权限差异；不静默开启新能力或自动执行来自索引的代码。
- 上线目录前至少用一个外部示例走完提交、校验、安装、配置、运行、升级和卸载。

### 独立安全批次：发布签名

现有 PendingUpdate 模型继续保留。比较两种路线：在当前 Rust 下载/安装流程加入独立签名验证，或评估迁移到 Tauri 官方签名更新器并保留受控安装语义。先验证与已锁定的 Tauri 版本、资产格式和安装确认流程是否兼容，再选实现。

签名应绑定版本、平台、架构、大小和哈希；失败不启动安装，私钥不进源码、日志或普通配置，设计公钥轮换与丢失处置。Authenticode 是另一层签名，按证书与维护条件安排。负例至少包含错签名、错公钥、篡改包、版本绑定不符、缺签名和过期/降级响应。

WASM/任意第三方逻辑、公开访问层自动故障切换均后置为独立项目，先确定真实需求、能力边界和维护者。当前不安装 WASM 运行时，也不宣称已经具备沙箱或自动修复。

## 四、实施规则与下一步

1. 每批单独交付、单独验收；只使用 main，不新建开发分支。
2. 第 0 批完成前保持正式发布停止；原候选也不再推荐作为“已无问题”的生产安装包。
3. 本次仅提交审计与方案。建议下一步先批准第 0 批的精确修复范围，然后补调用级测试、修正策略、制作下一补丁候选；官网与插件不混入这轮修复。
4. 每批开始时重读源码和远端状态；本文的 API/元数据快照只说明本次核验时点。

## 外部依据

- GitHub Topics 支持最多 20 个，名称用小写字母、数字和连字符；这不保证项目流量。[GitHub 官方文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- 复杂动画若使用 GSAP，应使用 gsap.matchMedia 管理响应式、减少动态效果及回收；无需把旧 ScrollTrigger.matchMedia 当新方案。[GSAP 官方文档](https://gsap.com/docs/v3/GSAP/gsap.matchMedia%28%29/)
- Tauri 官方 updater 的签名需要明确公钥/私钥及构建集成；官方插件的能力不会自动赋予本项目的自定义更新器。[Tauri 官方文档](https://v2.tauri.app/plugin/updater/)

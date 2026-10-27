# 镜云代码结构审计与统一方案

日期：2026-10-26。对象：D:\image-hosting-platform，本地 main `9502431f8cf8fc50ef770061f08d84bbc10895bc`。用户已确认按推荐方案分批实施。本文为已确认设计，实施和验证进度以各批记录为准。

## 1. 结论与目标

已有技术栈分工合理，建议保留框架，统一模块职责、调用边界、状态、错误和验证方式。React 桌面界面与 Astro 文档站属于不同产物；Rust 领域、应用、Provider 和持久化已经分为 workspace，不建议把它们合成一个大模块。

本轮真实运行基线：97 个前端调用/Rust 命令/注册项一致；639 条现有用户流程静态断言全部通过；桌面 TypeScript/Vite 构建、静态校验、R2 离线诊断 9 项和 TaskUI 9 个单测通过。构建有大于 500 kB chunk 和无效动态导入警告。工作区在审计期间保持干净。未重跑 Rust 编译/测试、文档构建、浏览器或云端 E2E。

## 2. 建议统一的框架与方法

| 职责 | 沿用的方案 | 统一约定 |
| --- | --- | --- |
| 桌面界面 | React + TypeScript + Vite + Tailwind | page 负责组合，业务状态与操作进 features，共享平台能力单独封装 |
| 后台数据状态 | TanStack Query | 每业务域集中查询键、请求参数、轮询、失效与事件更新规则 |
| 跨页界面状态 | Zustand | 导航、弹窗、toast、确认等；不再复制一份后台数据缓存 |
| 局部表单和草稿 | React state | 保留在组件或业务 hook，保存成功后以后台结果为准 |
| 桌面桥接 | Tauri command | IPC 名称、参数、serde 字段、返回值保持兼容；命令层负责边界转换 |
| 后端业务 | 现有 Rust workspace / Tokio | application 管策略，storage-core 管端口，具体存储与持久化保持各自边界 |
| 数据库 | SQLx + SQLite | repository 分模块，根模块 re-export；不顺带改 SQL、事务或迁移 |
| 文档站 | Astro / Starlight | 独立静态产物，沿用现有构建 |
| 测试 | Cargo、现有 Node/Python、现有浏览器测具 | 统一入口与结果分类，优先复用，不新增测试框架或安装依赖 |

## 3. 源码证据

### 大文件与职责混合

| 文件 | 实际行数 | 主要问题 |
| --- | ---: | --- |
| D:\image-hosting-platform\apps\desktop\src-tauri\src\commands.rs | 4023 | DTO、设置、Provider 装配、发布、插件、修复与持久化混合 |
| D:\image-hosting-platform\crates\persistence-sqlite\src\lib.rs | 1873 | 多个 repository、记录类型、SQL 和测试汇集 |
| D:\image-hosting-platform\apps\desktop\src\pages\SettingsPage.tsx | 1656 | 核对、输出、系统集成、导入恢复、暂存审核和更新同处一个组件 |
| D:\image-hosting-platform\apps\desktop\src-tauri\src\cli.rs | 1074 | CLI 输入与发布、配置、凭据和 Provider 装配混合 |
| D:\image-hosting-platform\apps\desktop\src\lib\desktop.ts | 871 | 平台能力、业务请求、DTO、模拟回退和 toast 耦合 |

文件长度只是定位线索，拆分以职责和依赖为准，不设置机械行数目标。

### 已确认的重复与不一致

1. Provider 工厂重复：commands.rs:3339 与 cli.rs:973 分别构造相同的多类 Provider。可提取桌面 crate 内共享工厂，保留入口原错误表达；不能把 SQLite record、凭据库或具体 SDK 塞进 storage-core。
2. 发布策略已调用 PublisherCore，但桌面 commands.rs:2342 与 CLI cli.rs:494 仍重复处理、建模、落库、补偿和插件编排。应逐步收敛到服务，保留入口差异和事务边界。
3. 前端有 41 个 useQuery、38 个 useMutation、58 处 invalidateQueries，查询约定散落。TasksPage.tsx:16、PublishPage.tsx:68、UploadDialog.tsx:97 各自维护任务键和请求量；不能不经验证就合并缓存语义。
4. 异步事件订阅清理不一致：UploadDialog.tsx:108 有 disposed 保护，TasksPage.tsx:31 与 App.tsx:23 没有。存在 listen 完成前卸载时无法清理后来监听的源码风险；尚未运行故障复现，应先以延迟订阅的实际用例验证。
5. GalleryPage.tsx 与 StorageBrowserDialog.tsx 重复路径、图片识别、大小显示和单文件操作。默认分享时长、恰好 1 MiB 的格式边界及提示不同，统一复用时保留显式配置，不能借重构偷偷统一产品行为。
6. main.tsx:11 全局错误展示依赖 String(error)，mutation 用是否存在 onError 来推断是否已展示；R2 入口另有脱敏兜底。应建立显式错误展示约定，保留敏感路径，不宣称当前已发生泄漏。
7. scripts/dev.ps1:12 和 ui.ps1:4 会隐式 npm install，CI 使用 npm ci。应统一为显式准备依赖、消费锁文件；本轮不执行安装。

### 整理前必须确认的业务差异

- 插件 manifest：桌面 commands.rs:2190 经 effective_manifest 解析，CLI cli.rs:814 读取存量 manifest；需决定兼容政策后再共享服务。
- AI key 迁移：桌面 commands.rs:2129 对凭据写失败返回错误；CLI cli.rs:399 忽略该失败后仍删除旧 JSON key 的条件路径。需要故障注入验证；不能只移动代码或改注释。
- PublisherCore 注释描述“Primary 失败才触发 Backup”，实现及现有守卫已采用并发策略。重构冻结当前实际行为，策略变更须单独确认，不能按旧注释回改。

## 4. 目标目录与依赖方向

以下是渐进目标，各批只创建确有实现的模块，不预建大量空目录。

```text
apps/desktop/src/
  pages/                     七页组合入口，保留现有路径
  features/
    settings/                output / reconciliation / integrations / portable / updater
    upload/                  上传草稿、校验、任务与重试流程
    cloud-browser/           目录读取与单对象操作
    assets/ tasks/ plugins/  各业务 API、查询与局部组件
  platform/desktop/          runtime、invoke、剪贴板、外链和事件生命周期
  components/                真正跨业务复用的界面组件
  store/                     全局 UI 状态
  lib/desktop.ts             迁移期兼容导出，调用者分批迁移

apps/desktop/src-tauri/src/
  commands/                  Tauri DTO/命令边界
  services/                  Provider 装配、发布生命周期与插件上下文
  cli.rs                     CLI 输入/输出适配

crates/persistence-sqlite/src/
  lib.rs                     连接、迁移及稳定 re-export
  repositories/              按 Task / Storage / Asset / Workflow / Plugin 等职责拆分
  journal.rs remote_scan.rs asset_staging.rs  沿用已有独立模块
```

统一依赖方向：页面 → 业务 hook/查询 → 平台调用 → Tauri 适配 → 服务/application → StorageProvider 或 repository。domain、storage-core 不依赖 UI、Tauri 或具体 Provider SDK。

## 5. 推荐实施顺序与验收

### 首批：建立可验证的统一方法

- 用现有测试能力冻结需要抽取的纯计算和事件生命周期；先复现延迟订阅/卸载边界，再提取共享平台函数。若确认旧实现泄漏，分别列明缺陷修复与纯结构迁移的范围和证据。
- 将完全一致、无 I/O 的路径/图片判断等计算抽为共享函数。默认时长、缓存键、轮询、错误文案和文件大小格式差异保持原样。
- 统一现有检查的入口和分类：只读静态、纯函数、浏览器、Rust、会改源码的 mutation；运行入口不隐式安装依赖。
- 写清框架分工和模块放置约定，形成后续拆分的标准。

验收：相关 Node 用例与前端构建通过，原命令契约和安全覆盖不丢失；97/639 是本轮基线而非固定门槛，新增用例或合理迁移可改变总数。涉及静态守卫迁移时同批补行为证据，不留无执行作用的旧字符串骗过检查。

### 第二批：前端领域化

- 平台能力与领域 API 从 desktop.ts 分离，保持兼容入口及导出签名。
- 每域集中查询键与失效规则，第一步保留原键值；改变参数化缓存行为另列测试。
- SettingsPage 先拆纯展示 panel，再分离业务 hook；上传、图库和弹窗分别迁移。
- 明确 inline/toast/silent 的错误展示责任，敏感路径先验证再迁移。

### 第三批：Rust 服务收敛

- 先共享 Provider 构造并保留两处薄包装，再逐项收敛发布与插件上下文。
- CLI 永久 URL 要求、私有目标拒绝与桌面私有上传等入口语义保持。
- integrations 拆 local_api / os_integrations / output_preferences；保留鉴权在 body 前、回环地址、请求预算、超时和并发限制。
- repository 按职责拆分，保留公开 API、SQL、迁移和事务。

验收：Rust 格式/编译/单测、fake Provider 正反例和 IPC 契约。本机尚未发现可用 link.exe，Rust 完整验证需可用 MSVC 环境或针对新 SHA 的 CI；未经授权不安装工具或推送。

## 6. 重构时的测试约束

- check_contracts.py 递归扫描 TS/Rust，能适应拆模块，但只核对命令名称集合，不证明参数和行为相同。
- check_user_flow.py 固定读取多个旧路径，包含函数切片、调用次序和字符串数量断言。迁移时应让断言明确定位真实实现，并补原安全性质的行为证据，不能简单扫描全仓凑字符串。
- 测具与守卫存在 CHANGELOG fingerprint、HEAD blob 和工作副本对账；修改后区分预提交验证和提交后同 SHA 检查，不删除这些约束。
- verify:all 包含会临时修改源码的 mutation，只能在干净、无并发写入的工作树上独占运行。
- 基线重新签署须说明原因并先证明覆盖未丢失；不能通过重签掩盖失败。

## 7. 实施边界与方案选择

推荐 A：保留现有技术栈，按上述三批逐步重构，目标是边界清晰和方法一致。中等改动，可分批验收。

备选 B：只规范命名、目录说明和开发入口。改动较小，但重复逻辑与大组件仍在。

备选 C：重新评估或替换主框架。改动较大，目前源码证据不足以支持这一成本；需先另行明确迁移目标。

各方案均不默认授权依赖安装、数据库结构变更、版本升级、远端推送或真实云端操作。实施继续使用 main，保留两笔既有本地提交。

按已确认范围，把设计固化到本文件，各批建立具体计划，再按失败用例 → 最小重构 → 验证 → 独立审查实施。设计入库不代表所有重构已完成。

# 镜云插件化重构方案（Kernel + Plugins v1）

- 状态：提案（待授权 DDL 与版本号）  
- 基线：`main@69ec25d`，产品版本 1.4.16，Rust workspace 13 个成员  
- 范围确认：内核/插件边界已获认可；v1 只做「内置插件可禁用」，第三方动态插件放 v2  
- 目标版本：2.0.0（**未授权，实施前需点名确认**）

## 0. 摘要

把「镜云」从单体桌面应用改为「内核 + 插件包」结构：

1. **内核**只保留「一张图进、一个 URL 出」的发布闭环、存储端口、凭据、SQLite、任务队列、插件宿主和最小 UI 壳；
2. 现有业务能力全部拆成 **14 个内置插件**，随安装包发布、默认启用，行为与 1.4.16 一致；
3. 新增统一插件契约（manifest v2 + 六个贡献点 + `plugin_invoke` 分发 + UI slot registry），禁用任一插件后其页面/入口/命令整体消失，内核不受影响；
4. 内核代码不允许引用任何插件 crate，由 CI 规则守住；
5. v2 再开放第三方插件安装（WASM/进程沙箱、签名、市场），本轮只预留契约。

工期约 11 周（单人，含 1 周缓冲）；第 1 阶段结束即可在不改行为的前提下完成骨架，之后每个插件独立迁移、独立回滚。

## 1. 目标与非目标

### 目标

- 内核代码量 ≤ 8k 行（当前 `apps/desktop/src-tauri/src` 原始 14,195 行 + 业务 crates 11,513 行；口径见 `.ai/baseline/2026-11-16.md`）；
- 内核 Tauri 命令 ≤ 30 条（当前 `#[tauri::command]` 99 条、`lib.rs:135-235` 注册 106 项）；
- 每个业务能力有独立 manifest、独立测试、独立启用开关；
- 新增功能默认以插件形式进入，不改内核；
- 发布主链路性能不回退：p95 延迟增幅 ≤ 5%，冷启动增幅 ≤ 200 ms；
- 现有 640 条 user flow、99 条契约检查、23 组 unit 全绿（基线见 `.ai/TASKS.md:26`）。

### 非目标（本轮不做）

- 第三方插件安装/市场/签名插件包（v2）；
- 修改 `identifier`、签名链路、更新器校验逻辑、发布流程；
- 修改现有 SQLite 表结构、URL 格式、UI 视觉规范；
- 重写 React 组件或 Rust 业务逻辑——迁移以「搬家 + 注册」为主，不趁机重构算法；
- 新建 feature 分支（沿用 `AGENTS.md` 的 main-only）。

## 2. 现状基线

### 2.1 规模（O，2026-11-16 实测）

| 对象 | 规模 |
|---|---|
| `crates/domain` | 2,911 行 / 10 文件 |
| `crates/application` | 658 行 / 2 文件（`PublisherCore` + `CloudMutationCore`） |
| `crates/persistence-sqlite` | 3,219 行 / 4 文件 |
| `crates/plugin-runtime` | 846 行 / 2 文件（manifest v1 + 3 种声明式 kind） |
| `crates/storage-core` | 672 行 / 2 文件（`StorageProvider` port） |
| `crates/storage-github` / `storage-gitee` / `storage-opendal` | 746 / 596 / 481 行 |
| `crates/image-processing` / `workflow-engine` / `task-engine` | 199 / 183 / 170 行 |
| `apps/desktop/src-tauri/src` | 原始 14,195 行 / 22 文件；`commands.rs` 138,376 字节 / 26 命令；`commands/` 10 个模块共 99 命令 |
| 前端 | 63 个 ts/tsx、原始 9,049 行、98 处 `invoke(`（另有 3 处 `invoke<…>(` 泛型调用） |

### 2.2 耦合点（为什么现在改不动）

1. **provider 靠 switch 构造**：`apps/desktop/src-tauri/src/services/provider_factory.rs:35-87` 用 `match record.provider_key` 硬编码 6 家；新增一家要改工厂 + 存储表单 + `PROVIDER_MATRIX`。
2. **命令层是巨石**：`commands.rs` 138 KB 混着发布编排、便携迁移、插件管理、存储 CRUD；`lib.rs:135-235` 一次性注册全部命令，任何功能都要动这两处。
3. **UI 靠 page 字符串硬切换**：`apps/desktop/src/App.tsx:41-53` 八个 `page === 'x'` 分支，页面与设置项无法按插件裁剪。
4. **插件系统只覆盖声明式能力**：`docs/PLUGIN_ARCHITECTURE.md:35-41` 仅 template/webhook/ai_prompt 三种 kind，无法承载 provider/UI/工作流这类「代码型」扩展。
5. **策略与闭环混在一起**：`crates/application/src/lib.rs:99-192` 的 `publish_group` 把镜像/备份策略写进内核发布路径；`cloud-browser`（`commands/storage_entries.rs` 36 KB）和 `reconcile`（45 KB）也直接调 provider。

## 3. 目标架构

### 3.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/desktop（Tauri 壳：窗口/托盘骨架/单实例/更新器/签名）      │
│   commands: 内核强类型命令 ≤30  +  plugin_invoke 通用分发      │
├─────────────────────────────────────────────────────────────┤
│ 内核 crates                                                  │
│  kernel       装配、服务容器、生命周期、bootstrap             │
│  kernel-api   插件契约：manifest、贡献点 trait、JSON Schema    │
│  plugin-host  注册表、启用/禁用、权限 Gate、hook 总线、审计     │
│  kernel-store SQLite 迁移与核心仓储（asset/deployment/journal/ │
│               task/storage/settings/plugin）                  │
│  storage-core StorageProvider port + 错误分类                  │
│  job-engine   任务队列（原 task-engine）                       │
│  application  单目标发布、校验、回滚（PublisherCore 单路径）    │
│  credential-store、domain（瘦身）                              │
├─────────────────────────────────────────────────────────────┤
│ plugins/*（内置插件，crate + manifest + UI 模块）              │
│  provider-github / provider-gitee / provider-opendal-extra    │
│  image-transform / workflow / publish-strategy / reconcile    │
│  cloud-browser / portable-migration / task-console            │
│  integrations-os / ai-assistant / themes / diagnostics        │
└─────────────────────────────────────────────────────────────┘
```

依赖方向单向：`plugins → kernel-api → kernel`；内核 crate **不得** 依赖 `crates/plugins/*`（CI 强制）。

### 3.2 crate 结构（目标）

```text
crates/
  domain/                 # 瘦身：Asset/Variant/Deployment/Task/错误分类；Workflow/Recipe/StorageGroup 类型迁出
  kernel/                 # 新：KernelBuilder、ServiceRegistry、插件装配
  kernel-api/             # 新：manifest 类型、Plugin trait、贡献点 trait、PluginContext
  plugin-host/            # 由 plugin-runtime 升级：registry、manifest v1/v2、permission、dispatch、hook
  kernel-store/           # 由 persistence-sqlite 拆出核心仓储
  storage-core/           # 不变（port）
  job-engine/             # 原 task-engine（保留 crate 名 task-engine 也可，见 P1 任务）
  application/            # 只留单目标发布 + 回滚
  credential-store/       # 不变
  plugins/
    provider-github/      # 由 storage-github 迁入
    provider-gitee/
    provider-opendal-extra/   # OSS/COS/WebDAV 分支（R2/S3 留内核）
    image-transform/      # 由 image-processing 迁入
    workflow/             # 由 workflow-engine 迁入 + 类型
    publish-strategy/     # 由 application::PublisherCore 策略段迁入
    reconcile/
    cloud-browser/        # storage_entries + remote_index + CloudMutationCore
    portable-migration/
    task-console/         # 任务页 + 列表/取消/重试命令在插件侧封装
    integrations-os/      # Typora/快捷键/右键菜单/托盘菜单项/Local API 路由
    ai-assistant/
    themes/
    diagnostics/
```

前端：

```text
apps/desktop/src/
  kernel/            # AppShell、nav registry、page registry、plugin loader、基础页
  plugins/<id>/      # index.ts(x) 导出 register(registry)，pages/settings 组件
```

### 3.3 插件契约：manifest v2

每个插件目录一个 `plugin.json`（内置插件也走同一契约，构建期校验）：

```json
{
  "api_version": 2,
  "schema_version": 2,
  "id": "provider-github",
  "name": "GitHub 图床",
  "version": "1.0.0",
  "kind": "native",
  "builtin": true,
  "kernel": ">=2.0.0 <3.0.0",
  "requires": [],
  "description": "通过 GitHub Contents API 发布图片",
  "permissions": ["network", "secret"],
  "contributes": {
    "providers": [{
      "key": "github",
      "display": "GitHub 仓库",
      "config_schema_ref": "schema/provider-github.json"
    }],
    "ui": {
      "pages": [{
        "id": "storages.github",
        "slot": "settings.storage",
        "title": "GitHub",
        "entry": "ui/StoragesGithubSection.tsx",
        "order": 20
      }]
    },
    "commands": [
      { "name": "github_create_repo", "permission": "network" }
    ],
    "hooks": ["after_upload"]
  },
  "settings_schema_ref": "schema/settings.json"
}
```

- `kind`：`declarative`（v1 三种 kind 保留）、`native`（内置 crate）、`wasm`（v2 预留）。
- `api_version` 兼容：宿主支持 1 与 2；v1 manifest 原样加载，行为不变（升级教程写进 `docs/PLUGIN_ARCHITECTURE.md` v2 章节）。
- `contributes.*` 白名单校验：未知键直接拒绝安装/编译期失败。
- 校验器：`crates/kernel-api/src/manifest.rs` 提供 `validate_manifest()`，脚本 `scripts/check_plugin_contracts.py` 在 CI 中对每个 `crates/plugins/*/plugin.json` 执行。

### 3.4 六个贡献点（内核唯一扩展面）

| 贡献点 | trait / 注册 API | 调用方 | 现有实现迁入 |
|---|---|---|---|
| `providers` | `ProviderFactory: fn(&ProviderContext) -> Result<Arc<dyn StorageProvider>>` | 内核发布管线、cloud-browser | `provider_factory.rs` 的 github/gitee/oss/cos/webdav 分支 |
| `transform_steps` | `TransformStep::apply(&mut PreparedAsset) -> Result<()>`，按 `order` 排序 | 内核发布管线 `before_process → steps → after_process` | `image-processing`、`workflow-engine` 的 Resize/Convert/Rename |
| `publish_strategies` | `PublishStrategy::publish(&self, plan) -> Vec<PublishOutcome>` | 内核 `publish` 命令按 `strategy_id` 选择 | `PublisherCore::publish_group`（mirror_all / primary_with_backups） |
| `hooks` | `HookHandler::execute(&self, event, ctx)` | 内核 hook 总线（现有 6 个生命周期不变） | 现有 template/webhook/ai_prompt + 审计 |
| `commands` | `PluginCommand { name, permission, schema, handler }` | `plugin_invoke` 分发器 | `commands/*` 各模块中业务命令 |
| `ui` | `UiContribution { slot, id, title, entry, order, when }` | 前端 registry | 8 个页面、设置分区、导航项 |

附加薄覆盖（同一 registry 机制，不增加内核复杂度）：`http_routes`（Local API 路由）、`tray_items`（托盘菜单项）、`cli_commands`（CLI 子命令）。

### 3.5 生命周期与启用/禁用

```text
启动 → 读取已安装插件行（plugins 表）→ 校验 manifest → 依赖排序
     → 权限 Gate（Manifest 声明 + 用户授权两层，沿用 v1 模型）
     → 注册贡献点（提供方/步骤/策略/hook/命令/UI）
     → 启动 hook 总线与后台任务（插件自行 start/stop）

禁用插件 → 注销其全部贡献点 → 前端 registry 刷新（页面/设置项消失）
         → 已排队任务按其策略处理（默认：保留记录、不再调度）
```

- 内置插件首次升级时按 id **幂等种子**插入：缺行则插入并默认启用；已有行只补 manifest 版本，不覆盖用户的启用/权限/hook 选择（延续 `docs/PLUGIN_ARCHITECTURE.md:52` 的兼容原则）。
- 至少保留一个可用 provider：全部 provider 插件被禁用时，设置页给出阻塞式修复入口，内核不静默失败。

### 3.6 命令分发

- 内核命令保持现有名字与强类型签名（发布、存储基础 CRUD、设置、任务、插件管理、更新器、bootstrap），**不改名**，避免 640 条流程脚本重写。
- 插件命令统一：

```rust
#[tauri::command]
async fn plugin_invoke(
    state: State<'_, AppState>,
    plugin_id: String,
    method: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, PluginInvokeError>;
```

  分发器校验：插件已启用 → method 已注册 → 权限已授权 → JSON Schema 入参/出参 → 执行 → 审计日志。
- 前端 SDK：`apps/desktop/src/lib/desktop.ts` 增加 `invokePlugin(id, method, payload)`；迁移期允许旧命令名与新分发并存，P4 收口。
- `scripts/check_contracts.py` 从「扫描 `invoke(` ↔ Rust 命令名」改为「扫描 `invokePlugin(` ↔ `plugin.json` 的 `contributes.commands` + 内核命令白名单」。

### 3.7 UI 贡献（v1 构建期打包）

- `apps/desktop/src/kernel/registry.ts` 定义 `PageSlot`、`SettingsSlot`、`NavSlot`；
- `apps/desktop/src/plugins/index.ts` 用 `import.meta.glob('./*/index.tsx', { eager: true })` 收集插件入口，按后端启停状态过滤；
- `App.tsx:41-53` 的硬切换替换为 `<PageHost slot="main" />`；`SettingsPage` 的分区列表改为 registry 渲染；
- 页面组件保持现有文件内容与类名，迁移只改 import 路径与注册入口（视觉回归可对比 `docs/VISUAL_BASELINE.md` 基线图）。

### 3.8 权限（沿用并扩展 v1）

- 现有 4 个权限 `read_asset / network / secret / external_write` 不变；
- 新增 `provider_config`（改写存储配置）与 `fs_paths`（v2 第三方插件用，v1 内置插件默认授予但不暴露给声明式插件）；
- 权限 Gate 仍是「manifest 声明 ∩ 用户授权」，禁用插件即撤销全部注册。

## 4. 内核边界与插件清单

### 4.1 内核保留（不再外移）

| 模块 | 具体内容 |
|---|---|
| 应用壳 | 窗口、托盘骨架、单实例、关闭到托盘、窗口布局、更新器与签名校验（`commands/updater.rs`、`update_security.rs`） |
| 插件宿主 | manifest 校验、注册表、权限、hook 总线、`plugin_invoke`、审计、启停、种子 |
| 存储地基 | `StorageProvider` port、凭据库、**S3 兼容 provider**（R2/S3/MinIO 一条路，`storage-opendal` 的 s3 分支） |
| 发布闭环 | 单目标上传、readback 校验、回滚、Asset/Deployment/journal 落库、`asset://published` 事件 |
| 任务与存储 | `task-engine`、SQLite 迁移与核心仓储、设置存储、bootstrap 快照 |
| 基础 UI | 发布页、上传记录页、插件页、设置页（存储基础项 / 通用 / 外观骨架 / 更新 / 插件配置） |
| 入口适配 | CLI 二进制骨架（加载与桌面同一插件集）、Local HTTP 服务骨架（路由由插件贡献） |

### 4.2 插件清单（14 个，全部内置、默认启用）

| id | 承接现状 | 迁移来源 | 权限 |
|---|---|---|---|
| `provider-github` | GitHub 仓库图床 | `crates/storage-github` | network, secret |
| `provider-gitee` | Gitee 仓库图床 | `crates/storage-gitee` | network, secret |
| `provider-opendal-extra` | OSS / COS / WebDAV | `crates/storage-opendal` 的 oss/cos/webdav 分支 | network, secret |
| `image-transform` | Resize / Convert / 质量 | `crates/image-processing` 全部 | read_asset |
| `workflow` | 步骤、配方、命名模板 | `crates/workflow-engine` + WorkflowsPage + recipes 命令 | read_asset |
| `publish-strategy` | Mirror / Backup / Mirror All / Repair | `crates/application` 的 `publish_group` + `repair_asset` | network, external_write |
| `reconcile` | 漂移巡检 | `commands/reconcile.rs` 45 KB + `reconcile_cadence.rs` 17 KB | network |
| `cloud-browser` | 云端文件管理、图库、索引同步 | `commands/storage_entries.rs` 36 KB + `remote_index.rs` 15 KB + `CloudMutationCore` + GalleryPage | network, external_write |
| `portable-migration` | 导出/导入/恢复 | `commands/portable_assets.rs` 36 KB、`portable_backup.rs` 20 KB、`portable_references.rs` 31 KB（21 命令） | fs_paths |
| `task-console` | 任务中心页面 | TasksPage + `features/tasks` UI | 无 |
| `integrations-os` | Typora、全局快捷键、右键菜单、托盘菜单项、Local API 路由 | `commands/integrations.rs` 36 KB + `cli.rs` Typora 分支 | network, external_write, fs_paths |
| `ai-assistant` | AI 设置/规划/视觉 | `get_ai_settings`、`save_ai_settings`、`ai_plan_workflow` | network, secret |
| `themes` | 皮肤/主题 | `lib/theme` + `features/settings` 主题段 | 无 |
| `diagnostics` | 系统诊断/导出 | `get_system_diagnostics` + 相关 UI | fs_paths |

### 4.3 有意留在内核的「看起来像功能」项

- 更新器：安全边界，插件化没有收益；
- 托盘/窗口/单实例：OS 集成骨架，插件只贡献菜单项；
- 任务队列：所有插件共用，UI 页面外移；
- S3 兼容 provider：保证「零插件可用」的兜底路径与首启体验。

## 5. 数据模型

### 5.1 新增表（DDL 需授权 + 备份）

```sql
CREATE TABLE IF NOT EXISTS plugin_state (
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_capabilities (
  plugin_id  TEXT NOT NULL,
  capability TEXT NOT NULL,
  name       TEXT NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  PRIMARY KEY (plugin_id, capability, name)
);
```

- `plugin_state` 承载 v2 manifest 快照、插件自有小状态（替代每个插件加表）；
- `plugin_capabilities` 记录逐项授权（provider/transform/strategy/hook/command/ui）；
- **不改** `plugins`、`plugin_execution_logs` 及业务表；实施前先按 `AGENTS.md` 备份 `publisher.sqlite3`。

### 5.2 表归属

| 表 | 归属 | 说明 |
|---|---|---|
| assets / deployments / journal / tasks / storages / settings / plugins / plugin_execution_logs | 内核 | 迁移与写入统一经 `kernel-store` |
| storage_groups / storage_recipes / workflows | `publish-strategy` / `workflow` 插件 | 表结构不动，仓储代码迁入插件 crate，仍用同一连接池 |
| remote scans / staging | `cloud-browser` / `portable-migration` | 同上 |

### 5.3 兼容

- v1 声明式插件（api 1）继续可装可跑，宿主双版本解析；
- 已装 v1 插件升级到 2.0.0 后：保留启用状态、权限、hooks、配置；manifest 版本补写，不自动新增外部写权限；
- 便携 manifest（portable_* 导出的 JSON）格式不变，字段只增不改。

## 6. 分阶段计划

### P0 基线与契约定稿（第 1 周）

任务：
1. 写 ADR：`docs/adr/0001-kernel-boundary.md`、`0002-plugin-manifest-v2.md`、`0003-command-dispatch.md`、`0004-ui-slots.md`；
2. 冻结 manifest v2 JSON Schema（`kernel-api` 内）；
3. 立基线：录一份发布 p95、冷启动、内存、`validate.py` 耗时与 640 flow 通过数；
4. 命令→插件映射表（见附录 A），逐条标注「留内核 / 迁插件 / 删除」；
5. 备份脚本：`scripts/backup_db.ps1`（复制 `%APPDATA%\dev.multicloud.publisher\publisher.sqlite3` 到带时间戳文件并校验 SHA256）。

验收：ADR 合入；schema 通过评审；基线数据写入 `.ai/WORKLOG.md`；无代码行为变化。

### P1 内核骨架（第 2–4 周）

任务：
1. 新建 `crates/kernel-api`、`crates/plugin-host`（由 `plugin-runtime` 迁入并扩展）、`crates/kernel`；
2. `AppState` → `Kernel`，服务容器（显式字段，不引入 DI 框架）；
3. manifest v2 解析 + 注册表 + 依赖排序 + 启停；
4. 内置插件种子：把 14 个插件以 `builtin` 行写入 `plugins` 表（幂等），默认全开；
5. `plugin_invoke` 分发器 + 权限校验 + 审计；
6. 前端 registry + `PageHost` + `SettingsSlot`，先接 3 个现有页面（发布/插件/设置）验证机制；
7. 新增脚本：`scripts/check_plugin_contracts.py`、`scripts/check_kernel_deps.py`（`cargo metadata` 断言内核 crate 不依赖 `crates/plugins/*`）。

验收：现有功能 100% 不变；640 flow、99 契约、23 unit 全绿；新建一个演示插件（`examples/plugins/kernel-demo`）可启用/禁用且其命令从 IPC 面消失；内核依赖检查通过。

回滚：整阶段为新增 crate + 开关，删除即回退。

### P2 数据面插件化（第 5–7 周，按顺序小步提交）

顺序与理由：先内聚（`image-transform`、`workflow`），再动 provider（影响首启），最后策略/巡检/浏览器/迁移（依赖 provider 抽象）。

1. `image-transform`：迁 `crates/image-processing`；内核发布管线改为「默认无处理 + 插件步骤链」；
2. `workflow`：迁 `workflow-engine` 与类型、recipes 命令、WorkflowsPage 后端；内核提供默认命名模板；
3. `provider-github` / `provider-gitee` / `provider-opendal-extra`：`provider_factory.rs` 改为注册表查找；三家各自 manifest + 构造器；S3 兼容路径留内核；
4. `publish-strategy`：`PublisherCore::publish_group` 与 `repair_asset` 迁入；内核只保留单目标发布与 URL 选择规则；
5. `reconcile`：迁 `commands/reconcile.rs` + `reconcile_cadence.rs`，后台任务改为插件 `start()`；
6. `cloud-browser`：迁 `storage_entries.rs`、`remote_index.rs`、`CloudMutationCore`、GalleryPage；
7. `portable-migration`：迁 21 条 portable 命令（最大单块，独立提交序列）；
8. `task-console`、`integrations-os`、`ai-assistant`、`themes`、`diagnostics`：按附录 A 逐组迁移。

每个插件完成定义：代码迁出内核、manifest 注册、命令经分发器、UI 经 registry、禁用它时内核无 panic、该功能 e2e 通过、文档/矩阵更新。

验收：每家插件「禁用→功能消失→主链路可用→重新启用恢复」三态测试通过；`check_user_flow.py` 全绿；无 `provider_key` 字符串残留在内核 crate。

### P3 UI 面收口（第 8–9 周）

任务：
1. 剩余页面（StoragesPage 的 provider 专属分区、GalleryPage、TasksPage、WorkflowsPage）全部改为插件 UI；
2. `AppShell` 导航由 registry 生成，顺序与图标由 manifest `order` 控制；
3. 设置页拆骨架 + 插件分区；Local API/快捷键/右键菜单配置迁 `integrations-os`；
4. UI 回归：`docs/VISUAL_BASELINE.md` 基线图逐页对比；键盘 smoke（`scripts/ux_keyboard_smoke.mjs`）。

验收：8 个页面视觉无差异（允许的差异需列出）；禁用插件后导航项与设置分区同步消失；无孤儿组件。

### P4 瘦身、文档与发布门（第 10–11 周）

任务：
1. 拆 `commands.rs`：内核命令留 ≤30 条，其余随插件迁出；`cli.rs` 同样按插件切分（Typora 分支随 `integrations-os`）；
2. 删除迁移期兼容分支与旧 `provider_factory`；
3. 文档：`docs/PLUGIN_ARCHITECTURE.md` 升 v2、`docs/ARCHITECTURE.md` 重画分层、website 插件教程、2.0.0 升级指南；
4. 性能复测（发布 p95、冷启动、内存）对比 P0 基线；
5. 安装包 smoke（NSIS/MSI，`scripts/smoke_windows_installers.ps1`）与更新器路径验证（1.4.16 → 2.0.0 升级保留九张业务表与插件配置）。

验收：全部验证矩阵通过；版本号与 DDL 已获授权；发布说明含内核/插件边界与迁移方式。

## 7. 文件级迁移映射

| 现有路径 | 去向 | 动作 |
|---|---|---|
| `crates/storage-github/` | `crates/plugins/provider-github/` | 整目录迁移 + `plugin.json` + 构造器注册 |
| `crates/storage-gitee/` | `crates/plugins/provider-gitee/` | 同上 |
| `crates/storage-opendal/src/lib.rs` 的 oss/cos/webdav | `crates/plugins/provider-opendal-extra/` | 拆分构造器；s3 分支留内核 |
| `apps/desktop/src-tauri/src/services/provider_factory.rs:35-87` | 内核 `provider_registry.rs` + 各插件 `build()` | 删除 match，改注册表查找 |
| `crates/image-processing/` | `crates/plugins/image-transform/` | 迁 `process_image` + `TransformStep` 适配 |
| `crates/workflow-engine/` | `crates/plugins/workflow/` | 迁 `prepare_asset`/`render_remote_path` + Workflow 类型 |
| `crates/application/src/lib.rs:99-192` | `crates/plugins/publish-strategy/` | 迁 `publish_group` 与策略测试 |
| `crates/application/src/lib.rs:257-340` | `crates/plugins/cloud-browser/` | 迁 `CloudMutationCore` |
| `apps/desktop/src-tauri/src/commands/reconcile.rs` + `reconcile_cadence.rs` | `crates/plugins/reconcile/` | 迁命令与后台节律 |
| `apps/desktop/src-tauri/src/commands/storage_entries.rs` + `remote_index.rs` | `crates/plugins/cloud-browser/` | 迁 15 + 1 条命令 |
| `apps/desktop/src-tauri/src/commands/portable_*.rs` | `crates/plugins/portable-migration/` | 迁 21 条命令与暂存逻辑 |
| `apps/desktop/src-tauri/src/commands/integrations.rs` 的 Typora/快捷键/右键/Local API | `crates/plugins/integrations-os/` | 托盘骨架与窗口逻辑留内核 |
| `apps/desktop/src-tauri/src/commands/updater.rs`、`update_security.rs` | 内核 | 不动 |
| `apps/desktop/src-tauri/src/commands.rs` | 内核 `commands/core/*.rs` + 各插件 `commands.rs` | 按附录 A 切分，先机械搬移 |
| `apps/desktop/src/pages/*.tsx` | 内核 4 页 + 插件 UI | 见 §4.2 |
| `apps/desktop/src/features/{cloud-browser,tasks,workflows}` | 对应插件 UI 目录 | 整组迁移 |
| `crates/plugin-runtime/` | `crates/plugin-host/` | 扩展 manifest v2、registry、dispatch；保留 v1 解析 |
| `crates/persistence-sqlite/` | `crates/kernel-store/` | 核心仓储留内核；业务仓储随插件迁出 |

## 8. 验证矩阵

| 阶段 | 必跑 | 新增 |
|---|---|---|
| P1 | `python scripts/validate.py`、`check_contracts.py`、`check_user_flow.py`、`npm run test:unit`、`cargo test` | `check_plugin_contracts.py`、`check_kernel_deps.py`、插件启停三态测试 |
| P2 | 上述 + 每插件对应 `test_*_api.mjs`、`verify_probes.mjs`、`verify_guard_mutations.mjs` | 每家 provider 的「禁用→恢复」e2e；发布 p95 对比 |
| P3 | `verify_all.mjs`、`ux_keyboard_smoke.mjs`、`verify_dialog_interactions.mjs` | 视觉基线逐页对比报告 |
| P4 | 全量 + `smoke_windows_installers.ps1` + 升级路径（1.4.16→2.0.0） | 内核行数/命令数/依赖检查、启动与内存预算 |

统一门：任何阶段不得降低既有通过数（640 flows / 99 contracts / 23 unit）；新增失败按阻塞处理。

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 640 条流程与 191 KB `check_user_flow.py` 强耦合页面结构 | 高 | 页面组件不重写、只换挂载点；每阶段全量跑；差异逐条确认 |
| `commands.rs`（138 KB）机械切分产生隐式耦合 | 高 | 先「搬文件不改逻辑」，再逐插件收口；一插件一提交；CI 强制 `cargo check` |
| 内置插件种子覆盖用户配置 | 中 | 幂等插入 + 只补 manifest 字段；升级测试覆盖「已装 v1 插件 + 自定义权限」场景 |
| 全部 provider 被禁用导致无法发布 | 中 | 设置页阻塞式修复入口；bootstrap 返回可用 provider 列表；首启向导兜底 S3 |
| 启动变慢（插件注册/种子/前端 glob） | 中 | 种子只做一次；前端 eager glob 仅内置插件；预算 ≤200 ms 并在 P0 固化基线 |
| 第三方契约将来要改（WASM/进程） | 中 | 本次贡献点全部 JSON Schema 化、不暴露 Rust 类型给插件边界；v2 只换执行器 |
| SQLite 并发写与迁移 | 中 | 迁移单一所有者（kernel-store）；插件不自建表；每阶段备份演练 |
| CLI/Typora 与桌面行为分叉 | 中 | CLI 加载同一 registry；Typora 流程纳入 P2/P4 门 |
| 版本号/DDL/签名策略变更未授权 | 高 | 实施前单独确认；DDL 前备份并记录 SHA256 |

## 10. 工期

| 阶段 | 周 | 关键交付 |
|---|---|---|
| P0 | 1 | ADR + schema + 基线 + 映射表 |
| P1 | 2–4 | 内核骨架 + 分发器 + 前端 registry（行为不变） |
| P2 | 5–7 | 14 个插件中数据面 8 个迁完 |
| P3 | 8–9 | 全部 UI 插件化 + 视觉回归 |
| P4 | 10–11 | 瘦身、文档、性能、安装/升级门 |
| 缓冲 | +1 | 总计约 11 周（单人） |

若中途要求「第三方动态插件同轮交付」，增加 4–6 周（沙箱、签名、市场、权限模型升级），并把 P4 顺延。

## 11. 待授权与开放问题

1. **DDL**：新增 `plugin_state`、`plugin_capabilities` 两张表——需点名授权，实施前备份 `publisher.sqlite3`；
2. **版本号 2.0.0**：需点名授权（`AGENTS.md` 要求）；
3. `domain` 瘦身程度：`Workflow`/`StorageGroup` 类型迁到插件 crate 会造成 `domain` 公共类型破坏性变更，是否接受（推荐接受，2.0.0 一并做）；
4. `task-engine` 是否改名 `job-engine`（推荐保留原名，减少 CI/文档 churn）；
5. 内置插件是否允许卸载（推荐：允许禁用、不允许卸载，避免用户把首启体验弄坏）。

## 附录 A：命令→插件映射（99 条）

逐条清单见 `docs/PLUGIN_COMMAND_MAP.md`（含来源文件与收敛动作）。汇总：

| 归属 | 条数 | 代表命令 |
|---|---|---|
| 内核 | 37 | `bootstrap_snapshot`、`get/set_default_publish_target`、`publish_*_with_workflow`、`create_s3_storage`、`list_storages`、`test_storage`、`delete_storage`、`list_assets`、`delete_asset`、`list_tasks`、`cancel_task`、`retry_task`、插件管理 10 条、插件导入 2 条、更新器 4 条、`open_app_data_dir`、`get/save_output_preferences` |
| `portable-migration` | 21 | `export/inspect/restore_portable_*`、`preview_portable_*`、`stage/list/update/assess/apply/discard_*` |
| `cloud-browser` | 14 | `browse_storage`、`delete/move/download/create_storage_directory`、`batch_*`、`queue_batch_*`、`sync_storage_asset_index`、`create_temporary_share_link`、`preview_private_storage_entry` |
| `integrations-os` | 9 | `get_typora_integration_info`、`open_typora`、`get_local_api_info`、`regenerate_local_api_token`、快捷键 2 条、右键菜单 3 条 |
| `workflow` | 6 | `list_recipes`、`create_workflow_from_recipe`、`create_custom_workflow`、`list_workflows`、`set_default_workflow`、`delete_workflow` |
| `publish-strategy` | 4 | `repair_asset`、`create/list/delete_storage_group` |
| `reconcile` | 4 | `run_reconciliation_sweep`、`get/set_reconciliation_settings`、`get_reconciliation_history` |
| `ai-assistant` | 3 | `get_ai_settings`、`save_ai_settings`、`ai_plan_workflow` |
| `diagnostics` | 1 | `get_system_diagnostics` |

> 合计 99 条 `#[tauri::command]`（静态扫描，O）；`lib.rs:135-235` 注册 106 项。P1 只改传输方式，P2 起逐插件搬移，P4 收敛内核命令到 ≤30 条。

## 附录 B：基线数据采集项

- 发布 p95（10 张 2–5 MB JPEG，S3 兼容目标，本地 MinIO 或真实 R2）；
- 冷启动到首屏可交互（3 次取中位）；
- 空闲 RSS；
- `validate.py` / `check_user_flow.py` 墙钟时间；
- 安装包体积（NSIS + MSI）；
- 上述数据在 P0 与 P4 各采集一次，写入 `.ai/WORKLOG.md`。

## 附录 C：P0 产物（2026-11-16）

| 产物 | 路径 | 状态 |
|---|---|---|
| 4 份架构决策记录 | `docs/adr/0001-kernel-boundary.md`、`0002-plugin-manifest-v2.md`、`0003-command-dispatch.md`、`0004-ui-slots.md` | 已写 |
| manifest v2 契约 | `docs/schemas/plugin-manifest-v2.schema.json` | 已写，JSON 可解析 |
| 命令映射 | `docs/PLUGIN_COMMAND_MAP.md`（99 条全量） | 已写，命令名覆盖 99/99 |
| 静态基线 | `.ai/baseline/2026-11-16.md`（生成器 `scripts/baseline_metrics.py`） | 已采集 |
| DB 备份脚本 | `scripts/backup_db.ps1` | 已写，语法校验通过 |
| 运行时性能基线 | 发布 p95 / 冷启动 / RSS / 安装包体积 | **待云端 CI 采集**（本地不构建，见 `.ai/WORKLOG.md` 缺口记录） |

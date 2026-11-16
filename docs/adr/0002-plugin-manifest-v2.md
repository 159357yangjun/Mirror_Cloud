# ADR 0002 — 插件契约：manifest v2（JSON Schema 冻结）

- 状态：Accepted（2026-11-16，v1 只做内置插件、第三方放 v2 经用户确认）
- 相关：ADR 0001/0003/0004、`docs/schemas/plugin-manifest-v2.schema.json`
- 基线：`main@69ec25d`；现有实现在 `crates/plugin-runtime/src/manifest.rs`（`HOST_API_VERSION=1`、`MANIFEST_SCHEMA_VERSION=1`）

## 背景

现有 manifest（`docs/PLUGIN_ARCHITECTURE.md:14-33`）只描述声明式插件：

- `kind` 仅 `template/webhook/ai_prompt`，无法表达 provider、UI 页面、工作流步骤；
- 插件能力靠 `permissions` 4 项 + `hooks` 6 个，宿主无法枚举「这个插件到底贡献了什么」；
- 校验散落在 Rust 常量里（`MAX_MANIFEST_BYTES=256*1024`），没有可机读、可生成文档的契约文件。

插件化要求内核在**不加载任意代码**的前提下知道每个插件贡献了哪些扩展点，并在启用/禁用时整体注册/注销。

## 决策

1. **每个插件一个 `plugin.json`**：内置插件放 `crates/plugins/<id>/plugin.json`，与代码同目录、同提交；外部插件（v2）放插件包根目录。
2. **`api_version: 2` / `schema_version: 2`**，宿主同时支持 v1（声明式）与 v2；v1 语义不变，避免存量插件失效。
3. **`kind`**：`declarative`（v1 三种能力）、`native`（内置 crate，构建期编入）、`wasm`（v2 预留，v1 宿主直接拒绝）。
4. **贡献点白名单**（`contributes` 下只允许这 9 个键，未知键拒绝）：
   `providers`、`transform_steps`、`publish_strategies`、`hooks`、`commands`、`ui`、`http_routes`、`tray_items`、`cli_commands`。
5. **schema 引用**：`config_schema_ref` / `settings_schema_ref` / 命令 `input_schema_ref` 一律为插件目录内相对路径，禁止绝对路径与 `..`；构建期与安装期各校验一次。
6. **权限**：保留 `read_asset/network/secret/external_write`，新增 `provider_config`（改写存储配置）与 `fs_paths`（导出/迁移类路径访问）；实际生效 = manifest 声明 ∩ 用户授权（沿用现有两层 Gate）。
7. **依赖**：`kernel` 为 semver 范围；`requires` 为插件 id 数组，宿主做拓扑排序并拒绝环。
8. **版本**：插件自身 semver 与产品版本解耦；产品 2.0.0 只约束 `kernel` 范围。
9. **体积/解析**：manifest ≤ 256 KiB、UTF-8、禁止重复键；沿用 `MANIFEST_SCHEMA_VERSION` 常量语义。
10. **禁止**：v1 不加载磁盘上的任何 DLL/SO/dylib/WASM；`native` 插件必须是随构建编入的 crate（宿主注册表里存在对应构造函数），否则拒绝启用。

## 契约文件

- 单一来源：`docs/schemas/plugin-manifest-v2.schema.json`（JSON Schema 2020-12）；
- P1 迁入 `crates/kernel-api/schema/plugin-manifest-v2.schema.json` 并由 `include_str!` 加载，`docs/schemas/` 保留为发布副本，二者由 `scripts/check_plugin_contracts.py` 做一致性校验；
- 校验器 `validate_manifest()` 同时做 JSON Schema 校验与语义校验（id 与目录名一致、贡献点内部 id 全局唯一、`native` 必须在宿主注册表中）。

## v1 → v2 兼容映射

| v1 字段 | v2 处理 |
|---|---|
| `kind: template|webhook|ai_prompt` | 保留，映射为 `kind: declarative` + `contributes.hooks` |
| `permissions` 4 项 | 原样合法 |
| `hooks` 6 个生命周期 | 原样合法，且自动获得 `hooks` 贡献 |
| `config_schema` | 保留；新增 `settings_schema_ref` 仅 v2 使用 |
| `api_version: 1` | 宿主走 v1 解析分支，行为不变 |

## 后果

- 新增能力时必须先扩展 schema（评审 + 版本号），不能靠插件「自定义键」绕过；
- 前端 UI 贡献与后端 manifest 必须同名同 id，`check_plugin_contracts.py` 负责对账；
- v2 的 WASM/进程执行器只替换执行层，manifest 不变。

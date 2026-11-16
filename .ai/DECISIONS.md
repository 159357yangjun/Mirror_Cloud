# DECISIONS

当前更新签名、正式发布与插件前三项实施均已有用户授权，无待重复批准事项。按已定范围收口，不加入社区索引或 WASM。更高版本签名下载/安装和插件原生 UI 实测缺口如实保留，不因等待用户交互而扩大结论。长期规则见 AGENTS.md。

## 2026-11-16 — 插件化边界与契约（P0）

- 内核边界：保留应用壳/托盘骨架/更新器与签名/插件宿主/存储 port+凭据+S3 兜底/单目标发布闭环/任务队列与 SQLite/基础 UI/CLI 与 Local HTTP 骨架；其余全部迁插件（ADR 0001）。用户已确认该边界。
- 插件范围：v1 仅 14 个内置插件（默认启用、允许禁用、不允许卸载）；第三方安装/市场/签名/WASM 放 v2（用户确认）。产品版本 2.0.0 与新增两张表的 DDL **尚未授权**，P0 不触库、不改版本号。
- 契约：manifest v2 + 9 个贡献点白名单；命令统一 `plugin_invoke`，内核命令保留原名并收敛 ≤30 条；UI 用 5 个构建期 slot（ADR 0002–0004）。
- 验证口径：静态基线用 `scripts/baseline_metrics.py`（原始行数）跨阶段对比；运行时性能基线交云端 CI 采集，不伪造。

## 2026-11-16 — 插件化 P1 落地（内核契约 crate）

- crate 切分：`kernel-api` 只放纯数据类型（不依赖任何插件/存储/Tauri），`plugin-host` 只做注册/开关/贡献/分发，`kernel` 只做 14 个内置插件装配；三者都不依赖 `domain`/`storage-*`/`persistence-*`，由 `scripts/check_kernel_deps.py` 守卫。
- `plugin_invoke` 传输：`pluginId + method + payload(Optional)`，错误用 `PluginInvokeError{plugin_id,method,code,message}`（camelCase），锁中毒映射 `internal`；其余 13 个插件在 P2 迁移前实现为 `PendingPlugin` 并返回 `unknown_method`，绝不伪造成功。
- 清单校验分层：`kernel-api::validate()` 只管结构性约束（版本、id、贡献唯一、能力去重、schema 体积），`native 必须 builtin` 与「WASM 一律拒绝」由宿主/校验层执行；`PluginKind::Wasm` 在 v1 直接拒绝。
- 前端页面发现：内核页（assets/storages/plugins/settings）优先，插件页按 `import.meta.glob('../plugins/*/ui.ts')` 注册并去重；P1 只映射 publish/gallery/tasks 三页。`page.workflows` 在迁移前从未渲染，P1 不补映射以免行为漂移，P2 随 workflow UI 迁移补齐。
- 迁移顺序：P2 按命令映射逐插件搬移（先 workflow/publish-strategy/reconcile 等读多写少组），每个插件搬完即补 `BuiltinPlugin` 实现与 `plugin_invoke` 切换，`check_contracts.py` 同步改为双向对账；P1 不切换任何既有前端调用。
- 契约同形性：`kernel-api::PluginManifestV2` 的 `contributes` 是宿主归一化形式（`Vec<Contribution>`），与 `docs/schemas/plugin-manifest-v2.schema.json` 的对象形态存在偏差；v1 内置插件不读磁盘 `plugin.json`，故 P1 不受影响。P2 加加载器时补 round-trip 断言（已记入 ADR 0002）。

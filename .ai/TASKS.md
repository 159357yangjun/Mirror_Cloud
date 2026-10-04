# TASKS

| # | 项 | 状态 | 备注 |
|---|---|---|---|
| A | PrimaryWithBackups URL 选择修正 | 完成（待 CI） | `select_public_url` 唯一选点 + 两面单测；63ae8c1 只修了并发，本轮补语义 |
| B | RELEASE_GATE_UPDATER 措辞分级 | 完成 | 完整自更新 ≠ 安全自更新（独立签名是后者的门槛） |
| C | G1 PendingUpdate 信任边界 | 完成（run#236 三关全绿） | download 登记后端 store、install 只吃 opaque id + canonicalize + 磁盘重算 SHA256；门禁 +3 断言同笔 |
| D | Local API auth-before-body + timeout + semaphore | 完成（run#240 三关全绿） | 头/体两相读取、bearer 过了才吃 body、按路由预算(64KB/32MB/0)、10s/120s timeout、8 并发 owned permit；门禁 +5 断言(279) |
| E | 存储/AI/Webhook endpoint HTTPS-loopback 政策 | 完成（用户复核通过 + 门禁 284/0） | Rust 为最终门：`require_https_or_loopback` 在 commands.rs:807/883/974 三条建库路径各调一次 + plugin-runtime `http_endpoint`；UI 在 StorageSetupDialog 镜像同政策；LAN/公网 HTTP 直接拒 |
| F | G2 RC 构建 | PREPARED，等人工 dispatch | 六项前置本轮 API/git 复算有证；唯一未发生的跃迁是 workflow_dispatch(dev)；**不得为此改源码/release.yml/tag**，候选源码冻结在 `6116e3d` |
| G | v1.4.5→v1.4.7 真机升级 E2E | 未开工 | 十行保真矩阵，版本号变了≠通过 |
| H | v1.4.7 不可变 tag | 未开工 | v1.4.6 已判污染 tag，不复用 |
| P2-1 | GitHub/Gitee remote index 1000 项截断 | 挂账 | list() 无 complete 标志；C 之后、RC 之前或 v1.4.7 之后处理 |
| P2-2 | 旧 Workflow UI / 兼容命令清理 | 挂账 | WorkflowsPage.tsx 是死 UI（PageKey 无 workflows）；先做 Legacy inventory 再删 |
| — | 迁移 down 脚本缺失（13 up / 0 down） | 结构性风险在档 | 每次 schema 迁移前先备份 %APPDATA%\dev.multicloud.publisher\publisher.sqlite3 |

# TASKS

| # | 项 | 状态 | 备注 |
|---|---|---|---|
| A | PrimaryWithBackups URL 选择修正 | 完成（待 CI） | `select_public_url` 唯一选点 + 两面单测；63ae8c1 只修了并发，本轮补语义 |
| B | RELEASE_GATE_UPDATER 措辞分级 | 完成 | 完整自更新 ≠ 安全自更新（独立签名是后者的门槛） |
| C | G1 PendingUpdate 信任边界 | 完成（run#236 三关全绿） | download 登记后端 store、install 只吃 opaque id + canonicalize + 磁盘重算 SHA256；门禁 +3 断言同笔 |
| D | Local API auth-before-body | 未开工 | integrations.rs:165 先读 32MB body 后鉴权；另加 read timeout + 连接 semaphore |
| E | HTTP 凭据政策 | 未开工 | plugin-runtime 允许 http://+Bearer；方案：HTTPS 默认 / localhost 放行 / 公网 HTTP 拒绝或强警告；WebDAV 同政策 |
| F | G2 RC 构建 | 未开工 | workflow_dispatch、无 tag、exactly-one NSIS + smoke |
| G | v1.4.5→v1.4.7 真机升级 E2E | 未开工 | 十行保真矩阵，版本号变了≠通过 |
| H | v1.4.7 不可变 tag | 未开工 | v1.4.6 已判污染 tag，不复用 |
| P2-1 | GitHub/Gitee remote index 1000 项截断 | 挂账 | list() 无 complete 标志；C 之后、RC 之前或 v1.4.7 之后处理 |
| P2-2 | 旧 Workflow UI / 兼容命令清理 | 挂账 | WorkflowsPage.tsx 是死 UI（PageKey 无 workflows）；先做 Legacy inventory 再删 |
| — | 迁移 down 脚本缺失（13 up / 0 down） | 结构性风险在档 | 每次 schema 迁移前先备份 %APPDATA%\dev.multicloud.publisher\publisher.sqlite3 |

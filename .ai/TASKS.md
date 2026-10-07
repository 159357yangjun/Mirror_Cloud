# TASKS

| # | 项 | 状态 | 备注 |
|---|---|---|---|
| A | PrimaryWithBackups URL 选择修正 | 完成（待 CI） | `select_public_url` 唯一选点 + 两面单测；63ae8c1 只修了并发，本轮补语义 |
| B | RELEASE_GATE_UPDATER 措辞分级 | 完成 | 完整自更新 ≠ 安全自更新（独立签名是后者的门槛） |
| C | G1 PendingUpdate 信任边界 | 完成（run#236 三关全绿） | download 登记后端 store、install 只吃 opaque id + canonicalize + 磁盘重算 SHA256；门禁 +3 断言同笔 |
| D | Local API auth-before-body + timeout + semaphore | 完成（run#240 三关全绿） | 头/体两相读取、bearer 过了才吃 body、按路由预算(64KB/32MB/0)、10s/120s timeout、8 并发 owned permit；同笔补 +5 断言（**当前总数见 `python scripts/check_user_flow.py`，勿在此钉死**） |
| E | 存储/AI/Webhook endpoint HTTPS-loopback 政策 | 完成（用户复核通过） | Rust 为最终门：`require_https_or_loopback` 在 commands.rs:807/883/974 三条建库路径各调一次 + plugin-runtime `http_endpoint`；UI 在 StorageSetupDialog 镜像同政策；LAN/公网 HTTP 直接拒 |
| F | G2 RC 构建 | PREPARED，等人工 dispatch | 六项前置本轮 API/git 复算有证；唯一未发生的跃迁是 workflow_dispatch(dev)；**不得为此改源码/release.yml/tag**，候选源码冻结在 `6116e3d` |
| G | v1.4.5→v1.4.7 真机升级 E2E | 未开工 | 十行保真矩阵，版本号变了≠通过 |
| H | v1.4.7 不可变 tag | 未开工 | v1.4.6 已判污染 tag，不复用 |
| P2-1 | GitHub/Gitee remote index 1000 项截断 | 部分完成（§19-20/§21） | 截断现在会被发现并记录为 partial，且不再落盘成快照；**分页本身仍未做**（Contents API 无 cursor），所以超 1000 项的目录依旧看不全 |
| K | 两个既有 stage 失败：theme_face_inventory mismatch=2、verify_shape DRIFT failed=4 | known issue，本轮不修 | 均早于本任务：前者是 `docs/VISUAL_BASELINE.md` 的设置面数字落后于代码（doc 165/24/7 vs code 194/29/8，文档最后改动 9839568 2026-10-02）；后者是 `scripts/verify_all.mjs` 被 66cb911(2026-10-04) 改过而未重签基线（基线 takenAt=2026-10-02 head=512bcfd9）。修法分别=文档追上代码 / `--snapshot --reason` 重签；都属对外结论或放宽门，需单独批准 |
| P2-2 | 旧 Workflow UI / 兼容命令清理 | 挂账 | WorkflowsPage.tsx 是死 UI（PageKey 无 workflows）；先做 Legacy inventory 再删 |
| — | 迁移回滚脚本覆盖不全（19 up 全部已执行 / 5 down：0015–0019） | 结构性风险在档，计数本轮复算 | 0001–0014 无 down；每次 schema 迁移前先备份 %APPDATA%\dev.multicloud.publisher\publisher.sqlite3 |

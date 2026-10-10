# R2 私有目标第一版 — 代码范围和使用说明

> 此文档对应 Issue #7 的**第一段**、Draft PR。它只实现“请求私有”的 R2 目标创建、桌面上传无公开 URL 的成功记录和资源页临时分享。**不证明远端 Bucket 真的是私有。**

## 从用户视角使用

1. 在 Cloudflare 创建**专用的私有 R2 Bucket**。在控制台确认没有启用 `r2.dev` 公网入口、公开自定义域名及未受保护的 CDN 缓存访问。访问策略必须由管理员配置，镜云不修改 Bucket ACL。
2. 镜云 → 云端 → 添加 Cloudflare R2 → 选择“私有存储目标”。填写 Bucket、Account ID、访问密钥，不需填写公开域名；点击“测试并保存”。测试验证 API 凭据有对象操作能力，**不能证明匿名访问被拒绝**。
3. 将新存储设为默认上传目标，打开桌面“发布”上传测试图片；到“任务”中确认任务完成，去“资源”找到新资产。
4. 资源卡显示“已上传 · 无公开链接”和“已请求私有、未验证外部权限”，不会把缺少公开 URL 当作上传失败。点击“临时分享”并按页面有效期选择 10 分钟、1 小时或 24 小时，成功后自动复制只读签名 URL。
5. **必须执行真实 E2E：** 使用 PR #6 的 `scripts/e2e_private_share.ps1` 和 `docs/PRIVATE_SHARE_E2E.md`，在独立无凭据请求中检查匿名请求拒绝、签名 GET 文件 SHA256 一致、链接到期后被拒绝。

## 范围和安全边界

- 配置 `S3StorageConfig.access_mode` 保存 `public` 或 `private_requested`；旧数据未指定时保持 `public`（向后兼容）。
- `private_requested` 只允许 R2，且要求 `public_base_url = null`。S3 Compatible、OSS、COS 等仍按旧公开发布行为，不暗中开放未验证的新模式。
- 存储目标元数据和资源 Deployment 都展示访问**意图**而不是“已验证私有”。这个版本不含访问控制探测结果、私有访问证据时间戳或跨云迁移。
- Desktop 工作流中，单目标私有 R2 按真实上传返回的结果记成功；对象文件本身仍由 R2 保存。无公开 URL 不触发 URL 自动复制/公开发布事件。
- 私有 R2 与公开/未知目标混用的 Storage Group 被禁止上传（含 UI 前置检查与实际 Group 执行入口）。私有目标不能靠切换本地配置隔离一个已经公开的 Bucket。
- Typora / CLI 的输出合同要求一个永久公开 URL；为避免写入后回滚或返回空链接，所有调用该路径的私有 R2 请求会在上传前被拒绝。要私有发布请使用桌面发布界面。
- 资源卡调用既有 PR #6 `create_temporary_share_link`。签名 URL 是敏感 Bearer 凭据，只放在剪贴板、不写入 SQLite、普通日志或插件结果；不要贴到公开 Markdown。
- 不涉及独立 SaaS、账号系统、任意代码插件、变更数据库表结构或 Windows `dev.multicloud.publisher` identifier。

## 建议验收

| 测试场景 | 预期 |
| --- | --- |
| 旧 R2 配置、旧 CreateS3StorageInput 不带 accessMode | 仍按公开模式，需要公开 URL |
| 新 R2 选择私有且不填公开 URL | 存储测试并保存成功，显示“私有模式请求 · 尚未验证” |
| 新 R2 选择私有但强行填写公开 URL | 后端拒绝，不创建存储 |
| S3 Compatible 输入 private_requested | 后端拒绝 |
| 私有 R2 与公开 R2 组合同步发布 | 发布前拒绝，无远端对象被此工作流写入 |
| 私有 R2 单目标成功写入 | Task completed、Asset online、无永久 URL |
| 资源卡临时分享 | 复制有时效的只读签名 GET URL |
| CLI/Typora 使用私有默认工作流 | 发布前明确拒绝，不执行上传或回滚 |
| 真实 Bucket 与过期验证 | **尚未完成，必须单独留证** |
| 未同步本地 EPIC-R 与当前旧远端适配 | **尚未完成，仍禁止合并** |

## 实际集成次序

此分支由 PR #6 的 `53e9b33` 分出，作为 stacked PR。若 PR #6 修改或集成到用户本地新 HEAD，应先更新本分支基线，在新 HEAD 上执行 Rust/TS 合同门与 Windows E2E，再合并。不能通过 GitHub 上的绿色 CI 代替本地工作树/远端真实私有访问检查。

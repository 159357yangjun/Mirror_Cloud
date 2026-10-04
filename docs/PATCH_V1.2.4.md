# v1.2.4 — Explicit Plugin Authorization

本版本不继续增加 Provider，而是把 v1.2.3 的插件权限检查补成真正的用户授权边界。

## 1. Manifest 声明不再等于授权

Runtime 现在同时要求：

```text
Manifest 声明权限
+
用户已授权权限
↓
才允许执行能力
```

插件即使声明了 `network`、`secret` 或 `external_write`，如果授权列表里没有对应能力，Runtime 会返回 `PermissionDenied`。

## 2. 授权状态持久化

新增 SQLite migration `0010_plugin_permission_grants.sql` 和 `granted_permissions_json` 字段。

升级旧数据库时：

- 仅保留基础 `read_asset` 授权；
- 任何请求网络、Secret 或外部写入能力的旧插件都会先被关闭；
- 用户重新开启时必须在插件页确认权限。

## 3. 插件页交互

开启缺少授权的插件时，界面会列出待授权能力并要求用户确认。授权后才调用 `set_plugin_enabled`。

插件卡片会区分“声明但未授权”和“已授权”，并提供“撤销敏感授权”；撤销时插件会先停用。

## 4. Desktop / Typora 共用授权

桌面端自动上传链、手动 `run_plugin` 和 Typora CLI 都把同一个持久化 `granted_permissions` 传进 Host Runtime，因此不存在“桌面拒绝但 Typora 绕过”的第二套权限状态。

## 5. 继续保留 v1.2.3 修复

- `primary_with_backups` 真正 failover；
- GitHub 测试连接检查仓库写权限；
- AI Caption 使用真实 `image_url` 多模态输入；
- GitHub PUT 后 GET / SHA 二次确认；
- 本地 / URL / 剪贴板 / Typora 共用隐藏默认上传链；
- 插件输出持久化并在资源页展示。

## 6. Dependency locks 状态

本环境没有 Rust/Cargo，且 DNS 无法解析 npm registry，因此不能制造可信 `Cargo.lock` / `package-lock.json`。项目继续使用已有的正式构建策略：联网 CI 先解析并生成 lock，再使用 `cargo --locked` 和 `npm ci` 构建，并上传本次实际使用的 lock artifact。第一次成功构建后应把三个 lockfile 提交回源码仓库。

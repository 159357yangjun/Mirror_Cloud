# v1.2.3 — Publish Reliability & Plugin Safety

这版不继续堆功能，专门修复独立验证发现的可靠性问题。

## 1. 多云 Backup 变成真正故障转移

`primary_with_backups` 的语义现在是：

```text
Primary
  ├─ 成功 → Mirror 继续同步，Backup 跳过
  └─ 失败/初始化失败 → Mirror 继续同步，Backup 接管
```

`mirror_all` 仍然会发布到所有成员。界面也明确提示“Mirror 始终同步；Backup 仅在 Primary 失败时接管”。

## 2. GitHub 测试连接增加写权限检查

以前“测试连接成功”只证明仓库和分支可读取。现在还会检查认证后的仓库权限中是否具备写权限；只读 Token 会在配置阶段直接提示需要 `Contents: Read and write`，避免真正上传时才得到 403。

## 3. AI Caption 真正读取图片

AI 插件不再只是把 `{url}` 拼进文本 Prompt。现在 OpenAI-compatible Chat Completions 请求使用多模态内容：

```text
text prompt
+
image_url: <真实公网图片 URL>
```

因此需要选择支持视觉输入的模型。

## 4. 插件权限开始由 Runtime 强制执行

Host Runtime 现在会在执行前检查 Manifest：

- Template：`read_asset`
- Webhook：`read_asset + network + external_write`
- AI Prompt：`read_asset + network`，使用 API Key 时还必须有 `secret`

旧版已安装的官方 AI Caption 会通过 `0009_upgrade_official_ai_caption.sql` 自动升级 Manifest。

这仍不是任意第三方 WASM 沙箱；当前安全模型是“声明式插件 + 受控 Host Runtime”。

## 5. 依赖可重复构建加固

由于当前离线打包环境无法访问 crates.io / npm registry，本源码包不能凭空生成可信的完整 `Cargo.lock` 和 npm lock。为避免继续使用漂移依赖，v1.2.3 做了两层处理：

1. 前端直接依赖改为精确版本，不再使用 `^`；
2. GitHub Actions / `scripts/release.ps1` 在有网络的正式构建环境先生成 `Cargo.lock`、桌面和文档的 `package-lock.json`，然后使用 `cargo --locked` 与 `npm ci` 完成后续检查和构建，并把实际使用的 lock 文件作为构建 Artifact 上传。

第一次成功的网络构建后，应把这三个 lock 文件提交回源码仓库，后续 Release 就能做到跨构建完全复现。

## 继续保留的核心闭环

```text
启动
→ 连接默认云端
→ 开关插件
→ 本地 / URL / 剪贴板 / Typora
→ 自动上传链
→ 远端确认
→ 插件执行并保存结果
→ 资源 / 图库 / 任务
```

GitHub 上传仍保留 PUT 后重新 GET / SHA 对比，只有远端真实存在才算成功。

# Multi-cloud Publisher v1.0.0 — 正式版源码基线

v1.0 的范围是：一个普通用户可以连接常用云端，选择一个 Recipe，然后通过本地文件、远端图片 URL 或系统剪贴板完成公网发布；高级用户可以把多个存储组成 Storage Group，并在某个副本失败后从健康云端自动修复。

## 正式功能

### 发布入口
- 本地文件选择与 Tauri 原生拖拽。
- 图片 URL 批量导入（最多 50 个；单个远端图片 32 MB 上限；HTTP/HTTPS）。
- 系统剪贴板图片读取，不需要先保存截图文件。
- 后台受控并发，当前每个应用实例最多 4 个上传任务同时执行。

### Provider
- Cloudflare R2。
- S3 Compatible。
- 阿里云 OSS。
- 腾讯云 COS。
- GitHub Repository Storage。
- Gitee Repository Storage。
- WebDAV。

凭据统一写入操作系统 Credential Store，SQLite 只保存 credential reference。

### Workflow / Recipe
- Resize。
- JPEG / PNG / WebP / Original。
- JPEG / WebP 质量参数。
- Rename Template：`{year}`、`{month}`、`{stem}`、`{ext}`、`{hash:N}`、`{uuid}`。
- 单 Storage 或 Storage Group 作为发布目标。
- 4 个官方 Recipe 和自定义 Workflow。
- 默认 Workflow。

### 多云
- Storage Group。
- Primary / Mirror / Backup 角色。
- Mirror All。
- Primary + Backups。
- Deployment 独立状态与错误。
- Partial 状态。
- 从健康 Deployment 读取内容并跨云 Repair；不依赖本地原图。

### 资源与输出
- 云端 Asset / Variant / Deployment 索引。
- 公网 URL 优先。
- URL / Markdown / HTML / BBCode / Custom Template。
- 发布成功后可自动把默认格式复制到系统剪贴板。
- 真远端删除；只有远端操作完成后才删除本地索引。
- Storage 云端目录浏览。

### 稳定性与安全
- 应用异常退出后，遗留的 queued / preparing / running 任务会在下次启动标记为中断，不伪装成仍在运行。
- 删除仍被 Deployment / Storage Group / Workflow 使用的 Storage 会被拒绝。
- Token / Secret 不写入 SQLite。
- URL 导入有协议、类型、超时和体积限制。
- SQLite foreign key 开启；增加常用查询索引。

### 教程站
`website/` 是 Astro + Starlight 静态教程站工程，包含 R2、OSS、COS、S3、GitHub、Gitee、WebDAV、Recipe、多云、剪贴板/URL 发布、本机 HTTP API 与安全说明。

## 教程站连接

`website/` 部署到 GitHub Pages 项目站点（`.github/workflows/docs.yml` 构建并发布 `website/dist`）。桌面构建需要注入同一个基址，`release.yml` 已经在 `windows-bundle` 作业里设置：

```text
VITE_DOCS_BASE_URL=https://159357yangjun.github.io/image-hosting-platform
```

桌面端将显示全局“教程与帮助”入口，以及每个 Provider 的“配置教程”按钮；未设置该变量时这些入口会自动隐藏而不是指向死链。`scripts/check_docs_site.py` 会在 CI 中校验文档站侧边栏、`astro.config.mjs` 的 `site` / `base` 与 `release.yml` 注入的基址三者一致。URL 只携带文档路径，不携带 Token、Secret 或任何账户凭据。

## 版本边界

v1.0 不把以下内容作为正式核心能力：插件市场、账号体系、云端控制平面、移动端、AI 功能、复杂 DAG Workflow、在线支付、自动故障切换域名。

这些功能如果未来加入，应保持 Domain / Application 与 Provider Adapter 的边界，不把历史兼容逻辑重新堆回 UI。

## 构建要求

- Node.js >= 22.12
- Rust stable（项目 `rust-toolchain.toml`）
- Tauri 2 对应系统构建依赖
- Windows：Visual Studio Build Tools + WebView2

开发：

```powershell
cd apps/desktop
npm install
npm run tauri dev
```

正式构建：

```powershell
./scripts/release.ps1
```

> 当前生成该源码包的执行环境没有 Rust toolchain，也没有安装 npm 项目依赖，因此本包是“v1.0 正式源码基线”，不能把未执行的 `cargo check` / `tauri build` 伪称为通过。首次发布安装包前必须在真实开发/CI 环境运行 release 脚本。

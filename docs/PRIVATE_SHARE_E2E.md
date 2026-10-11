# PR #6 · 私有对象临时分享真实验收

> 状态：**待真实 R2/S3 实测**。代码/CI 通过不能代替真实匿名 GET 或到期验证。本文是一套取证步骤，不是已经通过的测试报告。

## 0. 前置条件与范围

- Windows 上安装待验版本的镜云；只在测试 Bucket、测试对象上操作，不使用生产敏感图片。
- 仅 R2 / 具体已验证的 S3 兼容服务；尚不承诺所有 S3 服务、OSS/COS、WebDAV。
- R2 Bucket 必须由操作者确认没有配置公开的 `r2.dev` 或自定义域名；如果存在公开访问域名，**还必须测试对应对象地址的匿名 GET**。仅对 S3 API 请求返回 403，不足以证明没有另外的公开入口。
- 请不要为了通过测试去公开 Bucket，也不要把 Access Key、Secret Key 或包含 `X-Amz-Signature` 的 URL 发到 issue、PR、聊天、截图或日志。
- Windows 剪贴板历史、同步、录屏或恶意剪贴板监听程序可能保存链接；本脚本会默认清空当前剪贴板内容，但**无法保证清除历史记录**。

## 1. 测试用文件与私有目标

1. 使用一个小型测试图片，例如 `C:\Temp\mirror-e2e.png`，记录其本地 SHA256。
2. 以当前镜云支持的方式把它上传到 R2/S3 目标，记录远端对象 key（不记录凭据）。
3. 在 R2 控制台核实 Bucket 公开访问开关、`r2.dev`、所有相关自定义域名及公开缓存入口。确保该测试对象无公开入口。
4. 准备至少一个**匿名、未签名**的 S3 API 对象地址；有其它曾配置的公开域名时，把对应 URL 一并列入测试。不同域名、CDN 缓存必须分别检查。
5. 从镜云的“云端 → 浏览 Storage”选择对象，设为 **10 分钟**，点击“限时链接”，成功后链接自动复制至剪贴板。不要粘贴/打印它。

> 注意：当前 PR 只支持**已有对象生成临时链接**，还没有上传时 Public/Private 的完整访问模型。是否真正私有由云服务 Bucket / 域名策略决定。

## 2. Windows 机器上执行

在另一个 PowerShell 窗口运行（测试需要 10 分钟以上才能验证到期）：

```powershell
cd D:\image-hosting-platform

.\scripts\e2e_private_share.ps1 `
  -ExpectedFile 'C:\Temp\mirror-e2e.png' `
  -AnonymousUrls @('https://<account>.r2.cloudflarestorage.com/<bucket>/<object-key>') `
  -ExpiresInSeconds 600 `
  -CheckExpiration
```

将示例中的 account/bucket/object-key 替换为真实测试信息。实际 URL 必须匹配已测试对象和完整路径，包括 Storage Root；如使用了公开域名，可在 `-AnonymousUrls @('S3 API URL', '公开域名 URL')` 中追加相应地址。

脚本通过 PowerShell 的 `Get-Clipboard` 读取签名 URL，不在命令行传递它；无 Authorization / Cookie 请求匿名地址和签名链接；对签名响应计算 SHA256 与原文件比对。它只输出 HTTP 状态及是否通过，不输出完整 URL、响应体或原始 HTTP 异常。

## 3. 完整通过标准

| 验证点 | 必须拿到的实测证据 |
| --- | --- |
| 匿名保护 | 所有已知外部公开路径在没有签名的情况下均不能获取对象（例如 403/404） |
| 签名有效 | 全新进程、无存储凭据的 HTTPS GET 返回成功 |
| 内容正确 | 完整内容 SHA256 与本地测试文件相同 |
| 有效期 | 10 分钟分享在有效期内可用；到期并等待余量后再次请求原 URL 非 2xx |
| 权限边界 | 不使用 PUT/DELETE 签名、UI/日志/SQLite 不保存签名查询参数 |
| 兼容性 | 记录所测服务、Endpoint、地区和客户端版本；单个 R2 的通过不能代表全部 S3 Compatible |
| Windows 体验 | 网格/列表都能分享，忙碌状态、错误和剪贴板提示正确，旧发布与本地工作流无回归 |

所有项目完成后，可在 PR #6 评论中记录：

```text
Provider: R2 / <实际 S3 产品>
Region / endpoint 类型: <不含凭据>
客户端 commit / 包版本: <SHA / 版本>
测试对象: 已匿名化（不公开原图、key 或签名 URL）
Anonymous API: HTTP <状态>
Anonymous configured public domains: <域名数量> / <全部拒绝?>
Signed GET: HTTP <状态> + SHA256 匹配
Expired GET: HTTP <状态> + 等待秒数
Windows UI: PASS / FAIL
本地未同步代码整合: PASS / BLOCKED
```

如果异常请求因网络错误中断，要记作 **UNVERIFIED**，不能记为私有性通过。响应非 2xx 与网络不可达也应在最终报告中区分，必要时补充可控网络下的复测。

## 4. 合并前本地差异核对（只读）

此前记录本地提交 `f20428c`，GitHub 未能解析该 SHA。当前远端 `main` / `dev` 有大量分歧；不要以远端版本覆盖本地 EPIC-R。请在本地代码目录先执行：

```powershell
cd D:\image-hosting-platform
git status --short --branch
git log -12 --oneline --decorate
git branch -vv
git remote -v
git show -s --format='%H %P %s' HEAD
```

**禁止在核对前运行** `git reset --hard`、`git clean -fd`、`git push --force` 或盲目将 PR #6 合入现有开发工作树。先核实提交祖先关系、相同文件的修改以及未提交内容，再在独立集成分支移植。

## 5. 阶段边界

PR #6 满足代码质量和真实 E2E 后才能从 Draft 转为可合并；仍需过本地兼容性门。下一条独立 PR 才负责：存储真实访问策略、私有上传、资源访问状态、多云意外公开拒绝、资产持久化与显示。将“预期私有”与“实际验证私有”分开，不允许凭缺少 `public_url` 就宣称私有安全。

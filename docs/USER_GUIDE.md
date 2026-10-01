# 图床 | Image Hosting Platform 用户指南

当前文档对应 **v1.4.5**。

## 1. 第一次使用：先完成一条真实上传链

普通用户先理解三件事就够了：**云端 → 上传 → 资源/图库**。

1. 打开 **云端**，连接一个 Provider。
2. 测试并保存后，把它设为默认上传目标。
3. 打开 **发布**，上传一张测试图片。
4. 去 **任务** 看真实上传状态。
5. 去 **图库** 看 Provider 远端真实文件。
6. 去 **资源** 看图床维护的 Asset Index，并复制 URL / Markdown / HTML / BBCode。

插件、AI、多云组、Typora、快捷键和右键菜单都可以等第一张图片上传成功后再配置。

## 2. 资源和图库不是一回事

### 资源

“资源”是本软件维护的索引，记录：

- 文件名、MIME、大小、尺寸；
- Public URL；
- Deployment / Storage / Provider；
- 云端路径；
- 多云状态；
- 插件输出。

资源索引不保存另一份完整图片本体。

### 图库

“图库”直接调用 Provider 的 browse/list 能力，是远端文件浏览器。这里看到的是 GitHub / Gitee / R2 / S3 / OSS / COS / WebDAV 中真实存在的目录和文件。

因此：

- 图库里有图、资源页没有：说明远端文件存在，但还没有进入 Asset Index；
- 资源页有记录、图库找不到：要检查对应 Deployment 是否被移动、删除或失效。

## 3. 同步已有云端图片

如果仓库或对象存储中本来就有图片：

1. 确认 Storage 已启用；
2. 打开 **资源**；
3. 点击 **同步云端索引**；
4. 等待扫描完成；
5. 新发现的图片会作为元数据记录加入资源页。

同步行为：

- 只记录元数据、公开 URL、remote path、Storage；
- 不下载图片本体；
- 同一 Storage + remote path 已存在时跳过，不重复生成 Asset；
- 为避免首次同步失控，每个 Storage 单次最多扫描约 2000 个文件。

## 4. GitHub 最短验证路线

打开 **云端 → 添加存储 → GitHub**，填写：

- Owner：GitHub 用户名或组织名；
- Repository：仓库名；
- Branch：通常为 `main`；
- Root：例如 `assets`，也可以留空表示仓库根目录；
- Personal Access Token：建议 fine-grained token，只授权目标仓库；
- 权限：至少需要 Repository permission 的 **Contents: Read and write**。

### Root 的含义

Root 是这个 Storage 的远端根目录。

例如 Root=`assets`：

- 上传默认写入 `assets/...`；
- 图库从 `assets/` 开始浏览；
- 如果 `assets/` 还不存在，GitHub browse 不应因此把连接判定为坏连接；
- 仓库根目录原有图片不会出现在 `assets/` 图库视图中，除非把 Root 留空或建立另一个 Storage。

### GitHub 常见错误

- `401 Bad credentials`：Token 无效、过期或撤销；
- `403`：Token/仓库权限不足；
- `404`：检查 Owner / Repo / Branch，或确认私有仓库 Token 是否有访问权；
- `409 Conflict`：GitHub Contents API 的分支写入发生竞争。当前实现会刷新远端状态后重试；如果批量测试仍频繁出现，后续会使用 repo+branch 写入队列进一步收口。

## 5. Gitee / R2 / S3 / OSS / COS / WebDAV

### Gitee

填写 Owner、仓库、分支、Root 和访问令牌。公开链接策略与仓库是否公开有关。

### R2 / S3 / OSS / COS

对象存储除了 Bucket 与访问密钥，还要配置能被浏览器直接访问图片的 Public Base URL / CDN 域名。这个值不是云厂商控制台地址。

### WebDAV

需要服务器地址、路径和凭据；能否得到公网图片链接取决于你的 WebDAV 服务是否提供公开访问地址。

## 6. 插件

插件是上传后的行为开关，不是必须步骤。

- 新插件安装后默认关闭；
- 敏感权限需要用户明确授权；
- AI Caption / Markdown 类插件可以产生资源输出；
- Webhook 类插件会产生真实网络副作用；
- 插件失败不会回滚已经成功上传的远端图片；
- 执行结果可在插件页面查看日志。

## 7. 多云

连接至少两个 Storage 后，可以创建 Storage Group：

- **Primary**：主要写入位置；
- **Mirror**：随 Primary 一起写入；
- **Backup**：Primary 失败时接管。

资源出现 Partial 状态时，可以从健康副本 Repair 到失败的云端。

## 8. Typora 配置向导

图床不会偷偷改 Typora 配置。

正确流程：

1. 图床 → **设置 → Typora 集成**；
2. 检查默认上传目标和桥接状态；
3. 点击 **复制命令并打开 Typora**；
4. Typora → 偏好设置 → 图像；
5. 上传服务选择 **Custom Command / 自定义命令**；
6. 粘贴命令；
7. 点击 **验证图片上传选项**；
8. 回到图床确认任务和资源记录。

详细说明见 `docs/TYPORA_INTEGRATION.md`。

## 9. 全局快捷键、右键菜单和 Local API

这些入口全部复用同一条默认上传链：

- 全局快捷键：上传剪贴板图片；
- Windows 右键菜单：上传选中的图片文件；
- Local HTTP API：给脚本、ShareX 风格工具和未来 Agent 使用。端点、鉴权、状态码与已知限制见教程站 `/use/local-api/`。

Local API 只绑定 loopback，Token 保存在操作系统凭据库。

## 10. 皮肤

v1.4 Preview 已支持：

- 预设主题；
- 强调色；
- 壁纸 URL；
- 玻璃透明度；
- 毛玻璃模糊；
- 恢复默认。

后续计划再补系统浅色/深色、本地壁纸、自动取色、圆角和 UI 密度。

## 11. 安全原则

- Token / Secret / Password 不写入普通 SQLite 配置；
- GitHub/Gitee Token 尽量只授权目标仓库；
- AI API Key 放入系统凭据库；
- 删除云端文件是不可逆操作，执行前确认路径和 Provider；
- 正式源码包通过 `git archive` 生成，只包含 Git 已跟踪内容，避免把 `.git`、`target`、`node_modules`、本地数据库、缓存或测试安装包混入发行包。

## 12. 出问题先看哪里

推荐顺序：

1. **任务**：看真实错误；
2. **云端**：重新测试连接；
3. **图库**：确认远端对象是否真的存在；
4. **资源**：确认是否有 Deployment / Public URL；
5. **设置 → 系统诊断**：检查 Local API、Storage、插件、默认上传链和任务状态；
6. GitHub/Gitee 再检查 Token 与仓库权限。

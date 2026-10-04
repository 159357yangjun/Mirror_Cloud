# v1.3.0 — Publisher Core + Publish Center + Cloud Manager

这一版不是继续堆 Provider，而是吸收 PicGo 与 PicList 成熟设计中最适合 Multi-cloud Publisher 的部分，同时保留项目自己的多云可靠性与权限模型。

## 参考产品取舍

### 从 PicGo 吸收

- 上传应该尽量低摩擦，而不是先进入资源管理后台；
- GUI/Typora/未来 Local API 应复用同一个 Core；
- 默认入口强调拖拽、剪贴板、URL 与输出格式，而不是暴露内部 Workflow。

### 从 PicList 吸收

- 上传之后仍需要真正的云端文件管理；
- 云端列表、下载、删除应成为一级能力；
- 任务/历史应该可见，而不是只弹一个“成功”提示；
- 当前发布目标应能在上传页快速切换。

### 明确没有照搬

- 不切换回 Electron；继续使用 Tauri 2 + Rust；
- 不把 npm/任意 Node 插件代码作为默认安全边界；继续使用 Manifest + Host Runtime + Permission Gate；
- 不删除 Primary / Mirror / Backup / Repair；它们是项目相对 PicGo/PicList 的核心差异；
- 不把 SQLite 资产/部署/任务模型降级回纯 JSON 配置。

## 1. 多云策略进入真正的 Publisher Core

新增 `application::PublisherCore`：

```text
UI / Tauri / Typora / future Local API
                  ↓
           Publisher Core
                  ↓
      mirror_all / failover policy
                  ↓
         StorageProvider Port
```

`primary_with_backups` 的语义不再由桌面 Tauri command 自己维护：

```text
Primary
  ├─ 成功 → Mirror 继续；Backup 不执行
  └─ 失败 → Mirror 继续；Backup 按 priority 依次接管，首个成功后停止
```

Tauri 现在只负责加载配置/Provider 与持久化，策略规则由 `crates/application` 统一维护。

## 2. 默认首页升级为 Publish Center

应用启动默认进入“发布”页面，而不是资源列表。

Publish Center 直接提供：

- 当前默认 Storage / Storage Group；
- 常用目标快速切换；
- Tauri 原生文件拖拽；
- 本地文件、剪贴板、URL 三个入口；
- 当前输出格式（URL / Markdown / HTML / BBCode / 自定义）；
- “发布完成自动复制”开关；
- 最近发布资源；
- 最近任务与失败/警告状态。

真正的上传仍复用现有 `UploadDialog → hidden system pipeline → task engine`，没有为了新首页复制第二套上传实现。

## 3. 图库升级为安全 Cloud Manager

图库和 Storage 浏览弹窗从只读浏览扩展为：

```text
浏览 / 搜索 / 预览
复制公开 URL
浏览器打开
下载远端文件
永久删除远端文件
```

直接删除云端对象后，Publisher 会查询相同 `storage_id + remote_path` 的本地 Deployment，并同步标为 `deleted`，避免：

```text
远端已经删除
但资源页仍显示 online
```

删除需要显式确认；根目录不能通过该命令删除。

## 4. 上传入口状态统一

`useAppStore` 现在可以携带：

```text
requestedUploadMode
queuedUploadPaths
```

Publish Center 的拖拽、文件、URL、剪贴板入口全部打开同一个 UploadDialog。这样预览、任务状态、失败警告、插件执行与重试行为仍保持一致。

## 5. 继续保留 v1.2.5 的可靠性修复

包括：

- preflight 不再阻止 Backup 真正接管；
- URL 批量发布先完整校验后创建任务；
- 唯一远端路径，避免重复 Asset 共用同一对象；
- Repair 前校验 `content_hash`；
- Typora 保存 completed-with-warning；
- SQLite 落库失败时对安全唯一对象执行远端补偿删除；
- 新 Storage 的隐藏 Pipeline 初始化失败不会伪装成配置成功；
- GitHub/Gitee/OpenDAL 连接测试强化写能力验证；
- 插件 JSON 不能绕过 Credential Store 明文写入 API Key；
- 插件 Manifest 声明 + 用户授权双重 Permission Gate。

## 后续 v1.3.x

在 Core/UI 边界稳定后再继续：

- Tray 后台常驻；
- 全局快捷键；
- Local HTTP API；
- Mini Upload Window；
- 云端批量重命名/移动；
- 受 Permission Gate 控制的生命周期插件/脚本市场；
- 配置/索引跨设备同步。

这些能力会调用同一个 Publisher Core，不再分别实现上传逻辑。

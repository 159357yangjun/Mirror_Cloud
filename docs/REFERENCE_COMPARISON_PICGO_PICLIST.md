# PicGo / PicList / Multi-cloud Publisher 设计对比

日期：2026-09-23

目的不是复刻成熟项目，而是识别已经被长期用户验证的产品模式，再结合 Publisher 自己的多云、部署状态与权限模型做取舍。

## 1. 技术栈

| 项目 | 桌面框架 | UI | 核心 | 本地数据 | 扩展 |
|---|---|---|---|---|---|
| PicGo 3.x | Electron + electron-vite | React 19（仍有历史 Vue 依赖） | 独立 PicGo Core | 配置/Store | npm PicGo plugins |
| PicList 3.5 | Electron + electron-vite | Vue 3 + Pinia | `piclist` core | 配置 + Gallery DB | PicGo plugins + bundled npm + scripts |
| Publisher 1.3 | Tauri 2 | React 19 + Zustand + React Query | Rust `application::PublisherCore` + Domain | SQLite/SQLx + OS Credential Store | Permission-Gated Host Runtime |

### 结论

Publisher 不换 Electron。Tauri/Rust + SQLite 更适合：

- 多云并发和 failover；
- Asset / Variant / Deployment / Task 的强一致索引；
- OS Credential Store；
- 对插件 Network / Secret / ExternalWrite 做 Host-level gate。

## 2. PicGo 最值得吸收：上传不应该要求切换上下文

PicGo 的核心产品体验不是“支持很多图床”，而是：

```text
Drag / Clipboard / Hotkey / Editor / HTTP API
                    ↓
                 PicGo Core
                    ↓
                    URL
```

用户可以把 GUI 当配置中心，而不是每次上传都必须经过的应用。

Publisher 对应策略：

- v1.3.0 先把 Publish Center 设为默认首页；
- 文件 / URL / 剪贴板 / Typora 全部继续走同一隐藏 Pipeline；
- 后续增加 Tray / Global Shortcut / Local HTTP API / Mini Window 时只调用 Publisher Core。

## 3. PicList 最值得吸收：上传之后仍然要管理真实云端

PicList 相比 PicGo 更接近 Publisher 的目标：它把 Cloud Management 做成完整文件管理器，并有上传/下载任务队列、目录、删除、重命名等能力。

Publisher v1.3.0 首先吸收低风险、高价值部分：

```text
Gallery / Storage Browser
  ├─ List / Search / Preview
  ├─ Copy / Open URL
  ├─ Download
  └─ Confirmed Delete
          ↓
     remote provider
          ↓
 reconcile SQLite Deployment
```

后续再考虑：

- Move / Rename；
- Create Folder；
- 批量选择；
- 正则批量重命名；
- 持久化上传/下载 Task。

## 4. 多云：Publisher 不应该退化成“切换图床”

PicGo/PicList 的主交互通常是选择一个 uploader/config。

Publisher 的差异是：

```text
Publish Target
   ├─ Storage
   └─ Storage Group
         ├─ Primary
         ├─ Mirror
         └─ Backup
```

`PublisherCore` 必须持续拥有：

- `mirror_all`；
- Primary first；
- Mirror always；
- Backup failover-only；
- ordered first-success backup；
- Deployment status / repair。

这部分不因为参考 PicGo/PicList 而简化。

## 5. 插件：吸收生命周期，不复制安全边界

PicList 的脚本系统生命周期很值得参考：

```text
onSoftwareOpen
preProcess
beforeTransform
transform
beforeUpload
upload
afterUpload
onUploadSuccess
onGalleryRemove
manualTrigger
```

但其脚本运行时能够拿到 `fs / axios / Buffer / env` 等高权限 API。Publisher 不直接复制这一点。

Publisher 的长期插件模型应是：

```text
Lifecycle Hook
      ↓
Manifest declares capability
      ↓
User grants capability
      ↓
Host Runtime exposes only granted APIs
```

例如：

- `ReadAsset`
- `Network`
- `Secret`
- `Filesystem`
- `Clipboard`
- `ExternalWrite`
- `Destructive`

## 6. 配置同步

PicList 已有 GitHub/Gitee/Gitea/WebDAV 配置和 Gallery 同步，并使用 `id + updatedAt + lastSyncTime` 做合并。

Publisher 后续可以吸收“跨设备配置同步”，但不能直接同步：

- OS Credential Store 中的 Secret；
- 本机绝对路径；
- 未授权插件权限。

建议未来同步包分层：

```text
Portable Settings
Storage non-secret config
Plugin config without secrets
Output Preferences
UI preferences
Asset metadata (optional)

Secrets -> device-local only / explicit re-auth
```

## 7. v1.3.0 已采用的取舍

### 已采用

- Publisher Core 作为共享策略层；
- Publish Center 默认首页；
- 当前目标快速切换；
- 大型拖拽入口；
- Clipboard / URL 快捷入口；
- 输出格式和自动复制在发布页就能控制；
- 最近资源 / 最近任务；
- Cloud download/delete；
- 删除后的 Deployment reconciliation。

### 暂不采用

- Electron 重写；
- 任意 npm 插件直接成为主程序能力；
- `node:vm` 高权限脚本默认开放；
- 一次性堆大量 Provider；
- 配置同步（先稳定 schema 和迁移）；
- 云端 rename/move（先定义与 Deployment 的一致性语义）；
- Local API / Mini Window / Tray（下一批建立在 Publisher Core 上）。

## 8. 产品定位

目标不是“另一个 PicGo / PicList”。

更准确的定位：

> 一个后台化、本地优先的资源发布引擎：拥有低摩擦上传体验，同时提供可追踪的多云部署、Failover/Mirror、插件权限隔离和真实云端管理。

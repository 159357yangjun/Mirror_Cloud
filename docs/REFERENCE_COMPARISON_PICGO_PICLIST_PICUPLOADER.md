# PicGo / PicList / PicUploader / Multi-cloud Publisher 对比

日期：2026-09-23

目的：不是复制成熟项目，而是把经过长期使用验证的产品模式吸收到 Publisher，并保留 Publisher 自己的多云容灾、安全和领域模型。

## 1. 定位与架构

| 项目 | 核心定位 | 桌面/运行框架 | 核心语言 | 主要优势 | 主要架构代价 |
|---|---|---|---|---|---|
| PicGo | 极低摩擦图片上传 | Electron | TS/JS | Tray / Hotkey / HTTP API / 插件生态 | Node 插件权限高，领域模型较轻 |
| PicList | 上传 + 完整云端管理 | Electron | TS/JS | Gallery / batch / scripting / sync | 继承 Electron/Node 高权限扩展边界 |
| PicUploader | 多入口上传服务 | PHP + CLI + Web | PHP | Context menu / hotkey / Web / API / editor integration | 技术栈较旧，桌面体验不是现代 App 架构 |
| Publisher | 多云可靠发布平台 | Tauri 2 | Rust + React | failover / mirror / repair / SQLite / Credential Store / Permission Gate | 入口生态和云端批量管理仍在追赶 |

## 2. 产品体验

### PicGo

最值得吸收的是“零上下文切换”：GUI 是配置中心，而不是每次上传必须打开的页面。

### PicList

最值得吸收的是“上传以后继续管理真实云端”：目录、下载、删除、移动、重命名、批量操作、同步。

### PicUploader

最值得吸收的是“上传器也是服务”：右键、快捷键、Web、Typora、MWeb、ShareX 等入口都可以调用同一个上传能力。

### Publisher

应组合成：

```text
Desktop UI / Tray / Hotkey / Context Menu / Typora / HTTP / Agent
                              ↓
                        Publisher Core
                              ↓
                  Workflow + Task Engine
                              ↓
                    Storage Provider Port
                              ↓
                  Primary / Mirror / Backup
```

## 3. 性能

没有四个项目在同一机器上的 benchmark，因此这里只记录架构判断，不声称具体快多少。

Publisher 保留 Tauri + Rust：

- 桌面壳不额外携带完整 Chromium；
- Tokio 适合大量网络 IO；
- 多云 Mirror 可以并发；
- CPU-heavy 图片处理必须离开 async IO worker；
- 后续应增加分块/流式上传与更明确的 Task concurrency policy。

v1.3.1 已完成第一步：Workflow 图片 decode/resize/encode 使用 blocking worker。

## 4. 扩展与安全

PicGo/PicList 的 npm/Node 扩展生态成熟，但高权限能力很容易进入插件运行时。

Publisher 保持：

```text
Lifecycle Hook
      ↓
Manifest declares capability
      ↓
User grants capability
      ↓
Host Runtime exposes only granted APIs
```

后续可以吸收 PicList 生命周期 Hook，但不能把任意 shell/fs/network 默认开放给插件。

## 5. 取长补短路线

### 已在 v1.3.0 / v1.3.1 / v1.3.2 / v1.3.3 / v1.3.4 / v1.3.5 吸收

- Publish Center；
- Publisher Core；
- Gallery / Cloud Manager；
- remote download / delete；
- Tray；
- Local HTTP API；
- Typora bridge；
- OS Credential Store；
- explicit plugin permissions；
- CPU image worker isolation；
- Global hotkey；
- Windows Context Menu；
- Cloud Manager Move / Rename / Create Folder；
- multi-select / batch delete；
- lifecycle plugin hooks（before_process / after_process / after_upload / on_publish_failure / on_gallery_delete / manual_trigger）；
- batch move；
- template batch rename；
- persistent Cloud Manager batch tasks；
- cloud move strategy 下沉 application core；
- persistent cloud-task cooperative cancel / bounded retry；
- plugin execution audit；
- system diagnostics。

### 下一步

- regex batch rename；
- persistent upload/download queue；
- Local API 扩展为第三方工具稳定协议。

#### 后端差距的实测底数（2026-10-02，opendal 0.58.2）

上一轮把"qiniu / upyun / imgur / smms 四家加 feature 即可"排进迭代计划，是未核对依赖的估计。本轮实测推翻其中三条：

| Provider | opendal 0.58.2 是否有 `services-*` | 证据 | 结论 |
|---|---|---|---|
| upyun | **有** | crates.io `/api/v1/crates/opendal/0.58.2` 的 103 个 features 含 `services-upyun`；上游 `v0.58.2/core/Cargo.toml:216` = `services-upyun = ["dep:opendal-service-upyun"]` | 可走现成抽象 |
| qiniu | **无** | 同一 Cargo.toml grep `qiniu` = 0 命中 | PicList 是自实现的，我们也要自写 HTTP 集成 |
| imgur | **无** | 同上，features 全列表逐项核过 | 同上 |
| sm.ms | **无** | 同上 | 同上 |

⇒ "功能差距"里只有 1/4 是配置项，另外 3/4 每家都是一个完整的新 provider 开发。

一个新 provider 在本仓要动的 **9 个接线点**（已测绘）：
`crates/storage-opendal/Cargo.toml` feature、`storage-opendal/src/lib.rs`（Config + Credentials + 构造函数）、
`src-tauri/src/commands.rs`（ProviderSummary 目录、Input struct、create 命令、两处 `build_provider`）、
`src-tauri/src/lib.rs` 命令注册、`src-tauri/src/cli.rs` 第三处 `build_provider`、
前端 `types.ts` / `data/mock.ts` / `ProviderPickerDialog` / `StorageSetupDialog` / `StoragesPage` / `lib/desktop.ts`。
`storages.provider_key` 在 SQLite 无 CHECK 约束 ⇒ 不需要迁移。

约束：本机无 cargo/rustc（`~/.cargo/bin` 不存在、`where cargo` 空），Rust 侧改动只能由 CI 的 `cargo check --locked` 验证；
`scripts/check_user_flow.py:382` 有一条计数断言（"公开访问域名（发布到该云端时必填"文案必须恰好 3 处），
新 provider 若免填域名则不碰它，若要填则连断言一起改并过聚合门。

## 6. 不采用

- 不切回 Electron；
- 不放弃 SQLite Asset / Variant / Deployment / Task 模型；
- 不把多云降级成“切换图床”；
- 不开放无权限隔离的第三方脚本默认执行；
- 不让 HTTP / Typora / Tray 各自实现自己的 uploader。

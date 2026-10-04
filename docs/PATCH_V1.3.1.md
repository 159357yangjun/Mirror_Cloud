# v1.3.1 — Integration Layer & Background Publisher

这一版不继续增加 Provider，重点吸收 PicGo / PicList / PicUploader 已被验证的入口设计，同时保持 Publisher 自己的 Rust Core、多云可靠性和 Permission Gate。

## 1. Local HTTP API

新增只监听本机回环地址的 HTTP API：

```text
127.0.0.1:36677
├─ GET  /health
├─ POST /v1/upload
└─ POST /v1/upload-paths
```

安全边界：

- 只绑定 `127.0.0.1`，不监听 LAN / 公网；
- 上传接口必须使用 `Authorization: Bearer <token>`；
- Token 保存在 OS Credential Store；
- 设置页可以复制或重新生成 Token；
- 单次请求体最大 32 MB；
- 原始二进制上传使用 `X-Publisher-Filename` 指定文件名；
- 本地路径接口最多接收 100 个路径。

两种上传入口都直接调用现有 `cli::upload_with_default_workflow`，因此继续复用：

```text
Default Workflow
→ image processing
→ Primary / Mirror / Backup
→ enabled plugins
→ task / asset / deployment persistence
```

没有创建第二套 HTTP 专用上传器。

## 2. Tray / background mode

新增 Tauri 系统托盘：

- 左键托盘恢复主窗口；
- 托盘菜单提供“打开 Publisher / 退出”；
- 主窗口关闭时隐藏到托盘，不直接退出；
- 后台 Local API 与后续快捷键入口因此可以继续工作。

真正退出必须通过托盘“退出”或系统结束进程。

## 3. Command Layer 开始拆分

原 `apps/desktop/src-tauri/src/commands.rs` 接近 4,000 行。

v1.3.1 首先把以下集成职责迁移到：

```text
apps/desktop/src-tauri/src/commands/integrations.rs
```

包括：

- Typora bridge；
- Local HTTP API；
- Tray；
- App data directory；
- output preferences；
- Local API status / token rotation。

后续继续按 storage / gallery / publish / plugin / task 拆分，避免 Tauri 层重新成为业务大泥球。

## 4. 图片处理不再占用 async IO worker

Workflow 图片处理包含：

- decode；
- resize；
- JPEG / PNG / WebP encode；
- hash。

这些是 CPU-heavy 工作。v1.3.1 在桌面发布和 CLI/Typora 发布路径上都使用 `tokio::task::spawn_blocking` 调度处理，避免批量大图时阻塞负责网络和数据库 IO 的 async worker。

## 5. 设置页新增 Integration 控制面

设置页现在显示：

- Local API 是否正在监听；
- Base URL；
- Token 复制；
- Token 轮换；
- raw-body / local-path 两种调用方式；
- 只监听 loopback 与 Credential Store 的安全说明。

## 6. 对比项目后的明确取舍

### 从 PicGo 吸收

- GUI 不应成为每次上传的必经路径；
- 后台常驻；
- HTTP API；
- 编辑器 / 自动化入口统一指向一个 Core。

### 从 PicList 吸收

- 云端管理继续作为一级能力；
- 后续补 Move / Rename / Create Folder / batch operations；
- 生命周期插件可以学习，但不复制任意 Node 权限模型。

### 从 PicUploader 吸收

- Publisher 应该同时是“桌面 App”和“本机上传服务”；
- CLI / HTTP / 编辑器 / 快捷入口应该共用相同发布配置；
- 后续增加 Windows Context Menu 和更通用的第三方工具适配。

### 明确不做

- 不切回 Electron；
- 不新增无鉴权 LAN HTTP 服务；
- 不为了兼容插件开放任意 shell / npm 代码作为默认执行方式；
- 不复制另一套上传链。

## 下一阶段

v1.3.2 优先：

1. Windows Global Shortcut；
2. Windows Context Menu 上传；
3. Cloud Manager Move / Rename / Create Folder / batch select；
4. command 模块继续拆分；
5. Plugin Runtime lifecycle hooks。

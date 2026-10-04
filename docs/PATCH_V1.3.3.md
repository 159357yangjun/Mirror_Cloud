# v1.3.3 — Lifecycle Hooks & Batch Cloud Operations

这一版继续“取长补短”，但不再增加 Provider 数量。重点是把 PicList 的生命周期/批量管理思路与 Publisher 自己的 Permission Gate、多云 Deployment 一致性结合起来。

## 1. 插件生命周期不再只有“上传后”

新增 `PluginHook`：

- `after_upload`
- `on_gallery_delete`
- `manual_trigger`

Manifest 的 `hooks` 表示插件支持哪些事件；SQLite 新增 `enabled_hooks_json` 表示用户实际允许哪些事件。两者缺一不可。

迁移 `0011_plugin_hooks.sql` 对旧安装默认写入 `["after_upload"]`，因此升级不会让原有 Webhook 突然监听删除事件。

官方插件当前能力：

- Markdown Asset Card：after_upload / manual_trigger
- Webhook Publisher：after_upload / on_gallery_delete / manual_trigger
- AI Image Caption：after_upload / manual_trigger

插件页新增“触发器”开关。`manual_trigger` 关闭后，手动运行命令也会被拒绝。

## 2. Cloud Manager 删除事件进入 Host Runtime

单文件删除和批量删除真实远端对象成功后，会触发已启用的 `on_gallery_delete` 插件。

Webhook payload 增加：

```json
{
  "event": "on_gallery_delete",
  "name": "image.png",
  "url": "",
  "mimeType": "application/octet-stream",
  "metadata": {
    "source": "gallery_delete",
    "storageId": "...",
    "remotePath": "assets/image.png"
  }
}
```

远端删除本身优先：插件失败不会把已经删除成功的云端对象伪装成删除失败。

## 3. Cloud Manager 批量移动

多选文件后可批量移动到目标目录：

- 单批最多 100 个；
- 保留原文件名；
- 每个目标继续执行“禁止静默覆盖”检查；
- Provider 原生 move 优先，否则继续使用受控 download → upload → delete fallback；
- 成功后同步 SQLite Deployment 的 `remote_path / public_url`；
- 单项失败逐条报告，其余项继续。

## 4. 模板批量重命名

支持：

- `{name}`：原完整文件名
- `{stem}`：不含扩展名的文件名
- `{ext}`：包含点号的扩展名，例如 `.png`
- `{index}`：从 1 开始的当前批次序号

默认示例：`{stem}-{index}{ext}`。

生成结果禁止为空、`.`、`..` 或包含目录分隔符；目标冲突不会覆盖已有对象。

## 5. Tauri command 边界继续拆分

从 `commands.rs` 中进一步拆出：

```text
commands/
├─ integrations.rs
├─ storage_entries.rs
└─ plugins.rs
```

Cloud Manager 与插件命令不再继续堆回主 command 文件。前端 invoke / Rust command / Tauri registration 仍由递归契约检查保持一致。

## 6. 保留的 v1.3.2 能力

- Publish Center
- PublisherCore 多云策略
- Primary / Mirror / Backup failover
- Repair
- Local HTTP API
- Tray
- 全局快捷键
- Windows Explorer 右键上传
- Typora CLI bridge
- OS Credential Store
- Manifest + 用户授权 Permission Gate
- Cloud Manager create / rename / move / batch delete

本版是在这些基础上继续增强，不维护第二套上传逻辑。

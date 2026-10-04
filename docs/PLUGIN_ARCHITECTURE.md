# Plugin Architecture

## 目标

插件是 Publisher 的受控能力组件，而不是可以直接把任意原生代码注入主进程的脚本。v1.2.x 建立 Manifest、持久化和 Host Runtime；v1.2.4 起权限模型分成“Manifest 声明”和“用户实际授权”两层；v1.3.3 增加“插件支持的生命周期触发点”和“用户实际启用的触发点”两层；v1.3.4 把发布前后与失败 Hook 接入 Desktop、Typora 和 Local HTTP API 的同一执行语义；v1.3.5 增加持久化插件执行审计，记录 Hook、成功/失败、耗时与错误摘要。

## Manifest

核心字段：`id`、`name`、`version`、`description`、`kind`、`permissions`、`hooks`、`config_schema`。

当前 kind：

- `template`：纯文本模板能力。
- `webhook`：由宿主代发 HTTP POST。
- `ai_prompt`：由宿主调用 OpenAI-compatible API。

当前权限：`read_asset`、`network`、`secret`、`external_write`。

v1.3.4 当前真实接通的生命周期：

- `before_process`：读取输入资源后、进入图片处理前执行。
- `after_process`：Resize / Convert / Rename 等处理完成后执行。
- `after_upload`：真实上传、持久化完成后执行。
- `on_publish_failure`：发布链路失败时执行，用于通知/审计，不替代主错误。
- `on_gallery_delete`：用户从 Cloud Manager 永久删除真实远端对象后执行。
- `manual_trigger`：用户/宿主显式手动调用时执行。

Manifest 声明“插件支持什么”，SQLite `enabled_hooks_json` 保存“用户实际允许哪些触发点”。旧安装升级后只默认保留 `after_upload`，不会因为版本升级突然新增外部写操作。

## Runtime 执行边界

```text
Lifecycle event
      ↓
Manifest supports hook?
      ↓
User enabled hook?
      ↓
Manifest declares capability?
      ↓
User granted capability?
      ↓
Host Runtime exposes operation
```

Webhook 的生命周期事件会附带 `event` 和 `metadata`。Cloud Manager 删除事件包含 `storageId` / `remotePath`，但插件失败不会回滚已经完成的真实云端删除。v1.3.5 起每次实际执行会写入 `plugin_execution_logs`，插件页可以看到最近 Hook 的成功/失败、耗时与错误摘要。

## 安全原则

1. 插件不能直接访问全部 Credential Store。
2. 不加载任意 DLL / SO / dylib 作为默认扩展机制。
3. 网络能力由 Publisher Host 统一执行。
4. `network` / `secret` / `external_write` 等能力在启用前必须由用户显式授权；撤销授权会停用插件。
5. 生命周期触发点与权限授权是两套独立 Gate：开启 `on_gallery_delete` 不会自动授予 `external_write`。
6. Desktop、Typora CLI 与 Local HTTP API bridge 使用同一份持久化授权与 Hook 状态；发布生命周期都走相同 Runtime。
7. AI Planner 只生成计划，不静默执行远端写操作。

## 后续

- 后续评估 `before_upload` / `after_persist` 等更细生命周期，只有出现明确产品场景才增加。
- 将插件审计进一步关联具体 Asset / Task，并提供过滤与清理策略。
- 已签名插件包、Marketplace 更新通道。
- WASM Runtime、CPU/内存/超时限制以及域名级 Network 授权。
- Workflow `PluginAction` 节点和可视化 Block。

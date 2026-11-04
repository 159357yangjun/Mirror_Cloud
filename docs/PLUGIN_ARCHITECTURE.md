# Plugin Architecture

## 目标

插件是 Publisher 的受控能力组件，而不是可以直接把任意原生代码注入主进程的脚本。v1.2.x 建立 Manifest、持久化和 Host Runtime；v1.2.4 起权限模型分成“Manifest 声明”和“用户实际授权”两层；v1.3.3 增加“插件支持的生命周期触发点”和“用户实际启用的触发点”两层；v1.3.4 把发布前后与失败 Hook 接入 Desktop、Typora 和 Local HTTP API 的同一执行语义；v1.3.5 增加持久化插件执行审计，记录 Hook、成功/失败、耗时与错误摘要。

## Manifest

核心字段：`api_version`、`schema_version`、`id`、`name`、`version`、`description`、`kind`、`permissions`、`hooks`、`config_schema`。

自正式 v1.4.13 起，本地插件使用宿主 API **1**、Manifest Schema **1**，两者必须显式声明且精确匹配；插件自身的 `version` 仅表示插件版本。缺失或不支持的版本会被拒绝。历史内置的三个官方插件由宿主当前声明补齐缺失版本，保留已有配置、开关、权限和触发器；显式声明不兼容版本仍拒绝。桌面、Typora/CLI 和 Local API 使用同一兼容解析入口。v1.4.12 及更早安装包不包含本地文件安装与自动配置表单；操作步骤见 [插件教程](https://159357yangjun.github.io/Mirror_Cloud/use/plugins/)。

## 从本地文件安装（v1.4.13 起）

桌面插件页点击“从文件安装”，选择本地 UTF-8 JSON Manifest，查看名称、版本、兼容版本、声明权限和触发器后确认安装。可直接使用 [模板示例](../examples/plugins/markdown-card.plugin.json) 或 [Webhook 示例](../examples/plugins/webhook.plugin.json)。

- 文件不超过 256 KiB；仅接受已知字段、三种受控 kind、合法 ID、显式触发器和 `read_asset` 声明。拒绝 `official` / `official.*` 本地 ID、重复顶层字段及不兼容声明。
- 预览保存后端持有的 Manifest，确认时只接受一次性 ID，五分钟过期，最多保存四份预览；确认不会重新读取已被修改的原文件。
- 数据库插入采用原子“ID 不存在才插入”，并发或重复安装不会覆盖已有配置。
- 新安装默认关闭，仅授予基础 `read_asset`；网络、密钥、外部写入继续单独显式授权。仅默认选择已声明的 `after_upload`，不自动开启其他触发器。
- 文件只包含声明式配置，不加载脚本、原生代码或 WASM；导入与确认不会执行插件或发起网络请求。

## 自动配置表单（v1.4.13 起）

`config_schema` 是字段名到字段说明的对象，最多 32 项。支持 `string`、`url`、`boolean`、`number`、`integer` 和 `enum`，可填写 `title`、`description`、`required`、`default`、`enum`、`minLength`、`maxLength`、`minimum`、`maximum`。例如：

```json
{"endpoint":{"type":"url","title":"Webhook 地址","required":true},"format":{"type":"enum","enum":["png","webp"],"default":"webp"}}
```

配置页生成带标签的文本、数字、开关与下拉控件，前端提示错误，后端独立检查类型、长度、范围、必填和未知字段。关闭时可保存未完成配置，开启时必须完整。配置最大 64 KiB；字符串默认最多 4096 字符。URL 仅 HTTPS 或本机回环 HTTP，禁止内嵌用户名/密码。原有 AI `baseUrl` / `model` 非敏感覆盖保留；API Key 仍通过全局 AI 配置进入系统凭据库，不能定义为普通表单字段。

历史配置包含未声明字段时，表单不展示其内容，必须明确确认移除后才保存，未保存前保留原数据。

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
8. 插件 HTTP 请求有连接/总超时、重定向次数与协议检查、1 MiB 响应上限；错误不回显远端正文或请求 URL，AI 响应中的实际 API Key 会脱敏。

## 后续

- 后续评估 `before_upload` / `after_persist` 等更细生命周期，只有出现明确产品场景才增加。
- 将插件审计进一步关联具体 Asset / Task，并提供过滤与清理策略。
- 已签名插件包、Marketplace 更新通道。
- WASM Runtime、CPU/内存/超时限制以及域名级 Network 授权。
- Workflow `PluginAction` 节点和可视化 Block。

# v1.2.0 插件与 AI 能力层

本版本在 v1.1.0 的 Typora、真实上传验证和云端图库基础上新增第一阶段插件能力。

## 已实现

- 一级「插件」页面，包含插件市场、已安装插件和 AI Workflow Planner。
- `plugin-runtime` 独立 Rust crate；插件通过 Manifest 描述 ID、版本、类型、权限和配置 Schema。
- SQLite `0007_plugins.sql` 保存插件清单、启停状态与普通配置。
- 官方 Runtime 类型：`template`、`webhook`、`ai_prompt`。
- 官方首批插件：Markdown Asset Card、Webhook Publisher、AI Image Caption。
- OpenAI-compatible AI Provider 设置，可使用自定义 Base URL / Model / API Key。
- AI Workflow Planner 根据自然语言、已安装插件输出结构化 Workflow 草案，不自动执行外部写操作。
- 插件可启用、停用、配置、卸载和手动运行。

## 安全边界

- 当前版本不加载第三方 DLL / `.so`。
- 网络访问必须由宿主 Runtime 代发。
- Manifest 明确声明 `read_asset`、`network`、`secret`、`external_write` 权限。
- AI Planner 只生成草案，不会静默安装插件或执行远端写入。
- 社区 WASM 沙箱和签名插件市场留到后续版本。

## 仍需真实 Windows 构建验证

当前容器未安装 Rust/Cargo，无法宣称 Tauri/Rust 已实际编译通过。GitHub Actions 构建后需要验证插件页、数据库迁移、Webhook、AI Provider 以及 Typora 主链路。

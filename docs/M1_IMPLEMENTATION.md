# M1 实现记录

M1 已将 M0 的静态骨架推进为可执行链路：

- Cloudflare R2 / S3 Compatible 真实 Provider：OpenDAL S3 backend。
- 系统安全凭据：`keyring`，SQLite 仅保存 `credential_ref`。
- SQLite Repository：Storage / Task / Asset + Deployment。
- 后台 Task Engine：任务创建、状态迁移、失败持久化、Tauri event。
- 系统文件选择器：通过 Tauri Dialog 直接返回路径，不在 React 中复制图片字节。
- 原生拖拽：通过 Tauri Webview 的 drag/drop 事件取得真实文件路径，过滤为图片后加入发布队列。
- 上传链路：文件 -> SHA-256 -> MIME -> OpenDAL -> Deployment -> Public URL。
- UI：R2/S3 配置向导、连接测试、真实上传、任务页、真实资源页。

## 当前边界

- M1 只把 R2/S3 Compatible 标为真正可用；GitHub/Gitee 保留 Adapter 骨架，M2 接入仓库配置与上传。
- 图片处理（WebP/压缩/Resize）尚未接入，M2 加入 Workflow Engine 后执行。
- 当前上传使用 `tokio::fs::read` + OpenDAL bulk write；下一阶段对大文件改为 streaming writer / multipart。
- R2 公网地址需要用户启用自定义域名或合适的公开访问地址，并填入 `publicBaseUrl`；M1 创建 Storage 时强制要求该字段，避免“上传成功但别人看不到”。

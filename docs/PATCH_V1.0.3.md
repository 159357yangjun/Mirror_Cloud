# v1.0.3 — 窗口缩放与 GitHub Token 诊断修复

## 1. 窗口可缩放

- Windows 主窗口继续保持 `resizable: true` / `maximizable: true`。
- 将最小窗口从 `1024×680` 降到 `640×480`。
- 移除前端 `body min-width: 960px` 的硬限制。
- 窄窗口下侧边栏自动收缩，只保留图标；主内容区同步让位。
- Storage 配置弹窗在窄窗口下自动改为单列，避免字段被挤压。

## 2. GitHub `Bad credentials`

`401 Bad credentials` 表示 GitHub 没有接受当前凭据。v1.0.3 做了：

- Token 提交前自动去除首尾空格和误粘贴的 `Bearer ` 前缀。
- 如果用户把 SSH 公钥、SSH 指纹或私钥误填到 Token 字段，客户端会直接提示。
- GitHub 401 / 403 / 仓库 404 / 分支 404 使用不同中文错误提示。
- GitHub 配置窗口明确提示：这里需要 Personal Access Token，不是 SSH key 或 GitHub 密码。
- 增加“创建 Token”快捷入口。

Fine-grained PAT 建议仅授权目标仓库，并将 Repository permissions → Contents 设置为 Read and write。

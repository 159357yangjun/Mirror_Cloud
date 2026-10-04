# v1.1.0 — Typora 工作流集成与交互修复

## 1. 为什么之前“按方案发布”像没反应

旧逻辑在 Rust 后台任务刚创建后就立刻关闭发布弹窗。真正的上传可能随后失败，例如 GitHub 返回 `401 Bad credentials`，但用户只能到“任务”页才能看到失败，因此很容易误以为应用已经上传成功。

v1.1.0 改为：

1. 发布前先检查 Workflow 的主目标是否可连接。
2. 检查失败时直接停在发布窗口显示错误，不创建假成功任务。
3. 任务创建后弹窗不关闭，实时轮询任务状态。
4. 显示总进度、每个文件进度和失败原因。
5. 完成后提供“查看资源 / 查看任务 / 继续发布 / 重试”。

## 2. Typora 直传

Publisher 正式支持 Typora `Custom Command`。应用在“设置 → Typora 集成”生成类似：

```text
"C:\Program Files\Multi-cloud Publisher\multicloud-publisher-desktop.exe" --typora-upload --data-dir "C:\Users\you\AppData\Roaming\dev.multicloud.publisher" --
```

Typora 会在这个命令后自动追加本地图片路径。Publisher CLI 模式：

- 打开与桌面端同一个 SQLite 数据库；
- 读取系统凭据库中的 Token / Secret；
- 只使用被设为“默认”的 Workflow；
- 按输入顺序同步上传图片；
- 将每张图片最终公网 URL 各输出一行；
- 同时写入 Tasks / Assets / Deployments，因此以后打开桌面端仍能看到 Typora 上传记录。

命令行输出不包含 Markdown，只有 URL，以符合 Typora 自定义上传器的返回约定。

## 3. 云端图库

现在增加一级“图库”入口，同时保留“云端 → 我的存储 → 浏览”。两处读取的都是远端真实 Storage 内容，并支持：

- Grid / List 切换；
- 图片缩略图；
- 文件名搜索；
- 目录返回 / 根目录；
- 强制刷新；
- 点击图片大图预览；
- 复制公开 URL；
- 浏览器打开。

它展示的是**远端 Storage 的真实内容**，不是只展示本地 SQLite 中已记录的 Asset。

## 4. 设置页

删除了之前看起来像按钮但实际上只是静态说明的行。现在可见操作均有真实行为：

- Typora 命令复制 / 打开 Typora / 修改默认 Workflow；
- 管理云端凭据；
- 打开应用数据目录；
- 保存链接输出与自动复制行为。


## 5. 真实上传验证

针对“界面像成功但仓库里没有文件”的问题，GitHub Provider 在上传 API 返回成功后会再次读取仓库路径并校验 SHA。只有校验一致才会将 Deployment 标记为 Online。

Typora 设置区增加“一键开始配置”：复制 Custom Command + 启动 Typora 合并为一个动作。

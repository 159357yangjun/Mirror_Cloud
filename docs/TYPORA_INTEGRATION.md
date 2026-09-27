# Typora 配置向导 — Image Hosting Platform v1.4 Preview

## 目标

Typora 通过 **Custom Command / 自定义命令** 调用图床维护的默认上传链。Typora 不需要 PicGo；图床也不会偷偷修改 Typora 设置。

## 前提

先在图床里完成：

1. 至少连接一个可写 Storage；
2. 设置默认上传目标；
3. 最好先在“发布”页手动上传一张测试图，确认 Provider 本身正常。

普通用户不需要自己创建 Workflow。图床内部会维护默认上传链。

## 一次性配置

1. 图床 → **设置 → Typora 集成**；
2. 点击“重新检测”，确认命令已生成；
3. 点击 **复制命令并打开 Typora**；
4. Typora 打开偏好设置（常见快捷键 `Ctrl + ,`）；
5. 进入 **图像**；
6. 上传服务选择 **Custom Command / 自定义命令**；
7. 粘贴刚才复制的命令；
8. 点击 Typora 的 **Test Uploader / 验证图片上传选项**；
9. 回图床查看“任务”和“资源”，确认测试图片真实上传并产生公网 URL。

> “复制命令并打开 Typora”只做两件事：复制命令、启动 Typora。它不会自动改 Typora 偏好设置，所以不再称为“一键配置”。

## 上传链

```text
Typora 图片
  ↓
Image Hosting Platform executable --typora-upload
  ↓
默认上传链（处理 / 重命名 / 默认云端）
  ↓
Primary / Mirror / Backup
  ↓
当前已开启插件
  ↓
Asset / Deployment / Task
  ↓
最终公网 URL 输出到 stdout
  ↓
Typora 替换本地图片地址
```

插件警告写入 stderr，不应污染 Typora 读取的 URL 输出。

## 切换云端或插件

Typora 命令通常不用重配：

- **云端**：修改默认 Storage / Storage Group；
- **插件**：直接开启或关闭；
- **输出与处理**：修改默认上传链对应设置。

下一次 Typora 上传会读取最新配置。

## 验证建议

不要只看 Typora 是否显示“成功”，按下面顺序核实：

1. 图床“任务”出现 `Typora 发布`；
2. Provider 远端真的出现文件；
3. “资源”出现 Asset / Deployment；
4. Typora Markdown 中本地图片地址被替换为公网 URL；
5. 浏览器直接打开 URL 能显示图片。

## 故障排查

- **桥接未就绪**：先确认默认上传目标存在且可写；
- **Typora 仍显示 PicGo(app)**：说明上传服务还没有切换到 Custom Command；
- **命令已复制但没有变化**：复制命令不会自动修改 Typora，需要手动粘贴；
- **GitHub 401**：Token 无效/过期/撤销；
- **GitHub 403**：缺少仓库写权限；
- **GitHub fine-grained PAT**：目标仓库至少授权 `Contents: Read and write`；
- **GitHub 409**：分支写入竞争，当前 Provider 会刷新状态后重试；批量场景仍需继续通过写入队列优化；
- **插件导致警告**：检查插件页的权限、配置和执行记录。

## 后台运行

Typora 调用的是上传桥接命令，不要求主窗口一直显示。桌面应用的系统托盘/后台能力与 Typora 上传共用同一份配置和凭据。

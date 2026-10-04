# v1.3.2 — Zero-context Upload + Cloud Manager Mutations

这一版继续执行 PicGo / PicList / PicUploader / Publisher 的“取长补短”路线，不新增 Provider。重点是让上传入口更接近系统能力，同时让 Cloud Manager 从“能看/删”进入真正的远端文件管理。

## 1. 全局快捷上传

默认快捷键：

```text
CommandOrControl + Shift + U
```

执行链：

```text
clipboard image
→ PNG staging
→ cli::upload_with_default_workflow
→ default Workflow
→ Primary / Mirror / Backup
→ enabled plugins
→ final public URL(s)
→ clipboard
```

关键点：

- 不创建独立 hotkey uploader；
- 使用现有上传并发控制；
- 图片编码进入 blocking worker；
- 临时文件上传后清理；
- 设置页关闭快捷键时调用 OS unregister，真正释放组合键；
- 如果注册失败（例如被其他程序占用），设置页会得到明确失败。

## 2. Windows Explorer 右键上传

新增当前用户级注册表菜单：

```text
HKCU\Software\Classes\SystemFileAssociations\image\shell\MultiCloudPublisher
```

命令模式：

```text
Publisher.exe --shell-upload --data-dir "<app-data>" -- "%1"
```

特性：

- 不要求管理员权限；
- 路径显式加引号，支持包含空格的文件名；
- `--shell-upload` 仍调用 `upload_with_default_workflow`；
- 成功后把最终 URL 写入 Windows Clipboard；
- 设置页可以安装/卸载菜单。

## 3. Cloud Manager 进入写操作阶段

新增：

- Create Directory；
- Rename；
- Move；
- multi-select；
- bounded batch delete（单次最多 100 个路径）。

### Move 策略

Provider Port 新增：

```text
move_object(from, to)
create_dir(path)
```

OpenDAL Provider 使用原生 `rename` / `create_dir`。

不支持原生 move 的 Provider 使用安全 fallback：

```text
pre-check destination does not exist
→ download source
→ upload destination
→ delete source
   ├─ success → complete
   └─ failure → try deleting destination as rollback
```

不会静默覆盖已有目标路径。

## 4. 远端状态与 SQLite 对齐

远端 Move 成功后同步更新匹配的 active Deployment：

```text
remote_path
public_url
verified_at
```

批量 Delete 成功后把匹配 Deployment 标记为 `deleted`。

因此 Cloud Manager 不再出现“远端路径已经变了，但资源页还指向旧对象”的明显状态漂移。

## 5. 产品入口统一

现在主要入口为：

```text
Desktop Publish Center
Typora CLI
Local HTTP API
Global Shortcut
Windows Explorer Context Menu
        ↓
Default Workflow / Publisher Core
        ↓
Multi-cloud + Plugin Runtime
```

这正是本项目相对 PicGo/PicList/PicUploader 的核心取舍：入口可以越来越多，但发布核心只能有一个。

## 下一阶段

- Cloud Manager regex batch rename / create-folder behavior for repository-backed providers；
- persistent upload/download queue；
- lifecycle plugin hooks；
- command layer 继续拆成 publish/storage/gallery/plugin/task/integration；
- Local API 稳定协议、版本化错误码与第三方工具文档；
- 在 Windows CI / 真机完成 global shortcut、Explorer registry、Tray 与真实 Provider E2E。

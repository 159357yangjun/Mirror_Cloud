# 镜云 | Mirror Cloud

**多云图片上传与管理工具。**

镜云支持图片上传、云端文件管理、多云副本、图片处理和编辑器集成。

当前开发线：**v1.4.10（候选验证中）**。版本以 Cargo/package.json 为准，`scripts/project_state.py --verify` 检查一致性；开发版本不代表已正式发布。

## 核心能力

- **多入口发布**：桌面文件、拖拽、剪贴板、图片 URL、Typora、全局快捷键、Windows 右键菜单、Local HTTP API。
- **多云托管**：GitHub、Gitee、Cloudflare R2、S3 Compatible、阿里云 OSS、腾讯云 COS、WebDAV。
- **多云可靠性**：Primary / Mirror / Backup、Mirror All、Primary + Backups、Partial 状态和跨云 Repair。
- **图片处理**：Resize、JPEG / PNG / WebP、质量控制、Rename Template、统一 Workflow。
- **资源索引**：Asset / Variant / Deployment 只记录元数据、公开 URL、云端路径和插件结果；图片本体保存在真实云端。
- **云端图库**：直接浏览 Provider 真实远端目录，可预览、下载、删除、新建目录、移动、重命名和批量操作。
- **云端索引同步**：把云端原有图片同步进资源索引，不下载图片本体；重复同步会跳过已记录路径。
- **任务中心**：持久化任务、真实进度、取消、有限重试、失败和中断恢复。
- **插件系统**：Permission Gate、生命周期 Hook、Webhook / AI 插件和执行审计。
- **安全凭据**：Token / Secret / Password 进入操作系统凭据库，不写入普通 SQLite 配置。
- **皮肤系统**：Theme Tokens、预设主题、强调色、壁纸、透明度和毛玻璃参数。

## 统一发布链

```text
Desktop / Typora / Clipboard / URL / Tray / Shortcut / HTTP API / Shell Upload
                                  ↓
                         Default Workflow
                                  ↓
                    Resize / Convert / Rename
                                  ↓
                   Primary / Mirror / Backup
                                  ↓
                         Enabled Plugins
                                  ↓
                  Public URL + Asset + Task
```

所有入口复用同一个 Publisher Core / Workflow，不维护第二套上传逻辑。

## 资源与图库的区别

- **资源**：镜云维护的 Asset Index，用于统一复制 URL / Markdown、查看多云副本、插件输出和同步后的远端元数据。
- **图库**：真实远端文件浏览器，直接读取当前 Provider 的目录与对象。

“同步云端索引”只把远端图片的元数据加入资源页，不会把图片下载到本地。

## 桌面端页面

| 页面 | 用途 |
| --- | --- |
| 发布 | 选择默认云端并快速发布图片 |
| 资源 | 查看 Asset / Variant / Deployment 索引，并同步已有云端图片 |
| 云端 | 配置 Provider 和多云 Storage Group |
| 图库 | 管理真实远端目录和图片 |
| 插件 | 管理插件权限、生命周期和执行记录 |
| 任务 | 查看上传和批量云端任务，可取消或重试 |
| 设置 | Typora、快捷键、Local API、输出格式和系统诊断 |

## 项目结构

- `apps/desktop/src`：React页面、领域API、平台桥接及共享组件。页框统一使用 `PageLayout`，页头使用 `PageHeader`。
- `apps/desktop/src-tauri/src`：Tauri命令、CLI和桌面服务；`services/provider_factory.rs`共享已保存连接的Provider构造。
- `crates`：领域、发布策略、Provider适配器、任务和SQLite持久化。
- `website/src`：Astro教程站；平台说明在 `data/providers`，样式按职责分文件。
- `scripts`：现有构建入口、契约、单元及UI检查。

模块职责与调用方向见 [架构说明](docs/ARCHITECTURE.md)。协作规则统一见 [AGENTS.md](AGENTS.md)，开发只使用main，历史分支保留供审计，不创建任务分支。

## 本地查看与开发

用 VS Code 打开仓库根目录即可查看代码。桌面前端预览使用已有依赖：

```powershell
./scripts/ui.ps1
```

新环境需要依赖时，在 `apps/desktop` 显式执行 `npm ci`，消费锁文件。UI预览不要求本机安装MSVC/Windows SDK；浏览器模式不能代表原生功能验收。Rust编译、测试和桌面打包按本项目流程交给云端CI。

教程站位于 `website`，独立由Docs Site工作流构建发布。原生调试入口是 `scripts/dev.ps1`，仅在已经准备好本机Tauri编译环境时使用；脚本不会隐式安装依赖。

## 验证

```powershell
python scripts/validate.py
python scripts/check_contracts.py
python scripts/check_user_flow.py
python scripts/check_workflow_action_pins.py
python scripts/check_release_version.py
python scripts/check_tauri_dependency_family.py
```

完整本地发布检查：

```powershell
./scripts/release.ps1
```

GitHub Actions 的 `CI` 会继续执行 Rust format/check/test、桌面前端 build 和文档 build，并在耗时编译前检查版本同步、Tauri Rust/JS 依赖族兼容性以及外部 Actions 的不可变 SHA pin。`Release Bundle` 在手动触发时只生成构建产物；推送与项目版本一致的 `v*` tag 时才会创建对应 GitHub Release。

`Release Bundle` 在 Windows bundle 生成且依赖锁未被改写之后、暂存发布文件之前，会在真实 Windows runner 上执行 `scripts/smoke_windows_installers.ps1`，对 NSIS 与 MSI 完成静默安装、注册表卸载项校验和静默卸载；smoke 失败时上传 MSI 安装/卸载日志且不产出任何发布文件。本地跑完 `./scripts/release.ps1` 后可用同一脚本单独复现该检查（会真的在当前机器安装并卸载应用，已安装时会直接拒绝执行）。

## 发布产物

正式发布使用 **GitHub Releases**，而不是 GitHub Packages。Release 工作流会把 Tauri 原始文件名标准化为稳定、可脚本化使用的名称：

- `image-hosting-platform-v<version>-windows-x64-setup.exe`
- `image-hosting-platform-v<version>-windows-x64.msi`
- `image-hosting-platform-v<version>-source.zip`
- `SHA256SUMS.txt`

发布流程要求恰好生成一个 Windows EXE 和一个 MSI，并在发布前验证依赖锁未被构建过程改写。根目录不再长期保存某个旧版本的 release manifest/checksum 快照，避免开发线继续推进后产生误导。

## 文档

- `docs/USER_GUIDE.md`：当前使用说明
- `docs/TYPORA_INTEGRATION.md`：Typora 自定义命令接入
- `docs/ARCHITECTURE.md`：架构说明
- `docs/PLUGIN_ARCHITECTURE.md`：插件模型
- `docs/PROVIDER_MATRIX.md`：Provider 能力矩阵
- `docs/PATCH_V1.*.md` / `docs/VALIDATION_ACTUAL_*.md`：历史版本记录，只用于追溯，不代表当前 v1.4 Preview 状态

## License

见仓库根目录 `LICENSE`。

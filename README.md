# 图床 | Image Hosting Platform

**A multi-cloud image hosting, management and publishing platform.**

图床是一个面向创作、文档与内容发布场景的多云图片托管平台。它把图片处理、云端存储、公开链接、图库管理、任务追踪、插件扩展和编辑器集成放在同一条发布链里，而不是只做“上传到某一个图床”。

当前开发线：**v1.4.0 Preview（UX / Sync / Theme）**。

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

- **资源**：图床维护的 Asset Index，用于统一复制 URL / Markdown、查看多云副本、插件输出和同步后的远端元数据。
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

## 分支约定

- `main`：稳定、可发布版本。
- `dev`：日常开发主分支。
- `feature/*`：较大的独立功能。
- `fix/*`：独立缺陷修复。

多人或多 Agent 协作时，任何写操作前都应重新读取远端最新 `dev` SHA 和目标文件，发生并发修改时先 reconcile；禁止 force push 覆盖别人工作。

`main` 与 `dev` 的独立历史已经通过一个内容不变的双父提交完成安全桥接：`main` 现在是 `dev` 的祖先，后续可以正常 compare / PR；桥接过程没有改写 `main`，也没有 force push。

## 本地开发

```powershell
git clone https://github.com/159357yangjun/image-hosting-platform.git
cd image-hosting-platform
git switch dev

cd apps/desktop
npm install
npm run tauri dev
```

项目要求 Node.js `>= 22.12`、Rust `1.98.1` / Cargo、Windows Tauri 所需的 WebView2 和 Visual Studio C++ Build Tools。`rust-toolchain.toml` 会把仓库内 Rust 命令固定到当前验证过的工具链版本。

## 验证

```powershell
python scripts/validate.py
python scripts/check_contracts.py
python scripts/check_user_flow.py
python scripts/check_release_version.py
python scripts/check_tauri_dependency_family.py
```

完整本地发布检查：

```powershell
./scripts/release.ps1
```

GitHub Actions 的 `CI` 会继续执行 Rust format/check/test、桌面前端 build 和文档 build，并在耗时编译前检查版本同步与 Tauri Rust/JS 依赖族兼容性。`Release Bundle` 在手动触发时只生成构建产物；推送与项目版本一致的 `v*` tag 时才会创建对应 GitHub Release。

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

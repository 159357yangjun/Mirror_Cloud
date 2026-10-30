# 项目结构与架构

## 1. 产品边界

产品不是“本地图库”，核心目标是：

```text
输入资源 → 处理 → 发布到一个或多个云端 → 生成公网 URL → 持续管理部署状态
```

本地仅保存配置、索引、任务状态和必要缓存，不把本地原图管理作为主产品能力。

## 2. 五个核心领域

- **Asset**：用户语义上的一个资源。
- **Variant**：Asset 的具体文件版本，如原图、WebP、缩略图。
- **Deployment**：某 Variant 在某个 Storage 上的一次部署。
- **Workflow**：处理与发布步骤的顺序定义。
- **Task**：实际执行中的异步工作单元。

## 3. Storage 分层

```text
Domain / Application
        ↓
StorageProvider (Port)
        ↓
┌──────────────┬──────────────┬──────────────┐
OpenDAL Adapter GitHub Adapter Gitee Adapter
        ↓
S3/R2/WebDAV...
```

业务层不允许出现 `opendal::Operator`、GitHub API URL 或 Gitee API URL。

## 4. Capability

不同 Provider 能力不相同，所以 UI 和应用层都通过 Capability 判断功能，不假设所有云端都支持移动、公开 URL、版本管理等。

## 5. UI 原则

- 默认简单，高级功能渐进展开
- 发布是一级用户入口，但内部 Workflow 仍隐藏；首页围绕“快速发布 + 当前目标 + 最近结果”
- 资源/图库/任务是发布后的管理与诊断面
- Provider 配置使用向导，不直接暴露所有底层字段
- Storage Group 负责多云主存储、镜像和备份
- Workflow V1 使用线性 Step，不提前设计 DAG

## M2 repository adapters

Repository providers are first-class `StorageProvider` implementations:

```text
Application / Task Engine
          │
          ▼
    StorageProvider
      ├─ OpenDalStorage (R2/S3)
      ├─ GitHubStorage
      └─ GiteeStorage
```

The domain does not import provider SDK types. GitHub/Gitee-specific concepts (owner, repo, branch, content SHA, commit message) are isolated inside their adapters. `StorageCapabilities` tells the UI/application what a configured storage can do.


## 6. v1.3 Publisher Core

桌面 UI、Typora CLI 与 Local API 不应各自实现发布策略。多云策略逐步收敛到 `crates/application::PublisherCore`：

```text
Desktop / Typora / Local API
            ↓
      Publisher Core
            ↓
 Workflow/Image Processing
            ↓
 Publish Strategy
 Primary / Mirror / Backup
            ↓
      StorageProvider
            ↓
 Asset / Deployment / Task persistence
```

Tauri command 负责边界转换、Provider/凭据装配、事件与持久化，不再成为多云策略的唯一实现位置。

## 7. Cloud Manager consistency

直接从云端浏览器执行远端删除后，必须同步本地 Deployment 状态。任何新增云端管理动作都要明确回答：远端操作成功但 SQLite 更新失败时如何呈现和恢复，不能仅依据 HTTP 成功就把整个操作视为完成。


## 8. 当前源码目录与职责

| 位置 | 职责 | 调用边界 |
| --- | --- | --- |
| `apps/desktop/src/pages` | 页面组合、页面局部状态 | 复用PageLayout/PageHeader；请求进入features或迁移期desktop入口 |
| `apps/desktop/src/components` | 跨页面的界面组件 | 不创建第二套后台数据缓存 |
| `apps/desktop/src/features` | 领域API、查询键和局部组件 | assets/tasks/workflows已拆，其余渐进迁移 |
| `apps/desktop/src/platform/desktop` | IPC runtime、事件订阅、文件选择与剪贴板 | 不依赖页面 |
| `apps/desktop/src/lib/desktop.ts` | 兼容入口及尚未迁移的调用 | 已拆的API继续委托领域模块 |
| `apps/desktop/src-tauri/src/commands` | 命令边界及专项模块 | 保持IPC参数/返回值与安全确认 |
| `apps/desktop/src-tauri/src/services` | 桌面与CLI共享装配 | provider_factory只构造适配器，不测试连接、不上传 |
| `crates/application` / `storage-core` | 发布策略与Provider端口 | 不依赖React、Tauri或具体SDK |
| `crates/storage-*` | 存储适配器 | 保持服务商请求、能力与脱敏边界 |
| `crates/persistence-sqlite` | SQLite记录与仓储 | 不因目录整理改变SQL、迁移或事务 |
| `website/src/data/providers` | 每平台的准备信息、入口和字段说明 | providerGuides.ts维持统一导出，组件不复制数据 |
| `website/src/styles` | theme/layout/navigation/content/providers/responsive | custom.css只维护加载顺序，响应式覆盖最后加载 |
| `website/src/content/docs` | 直接可操作的教程 | 说明去哪操作、填什么、如何验证，不写宣传性文案 |

桌面页框只处理宽度和留白，页头只处理标题、描述和操作排版；不引入transform/filter/contain来包裹内容，以免改变fixed弹窗定位。壁纸仍在全应用底层，阅读透明度由现有主题变量控制。

Provider工厂统一缺凭据引用、解析配置、读取有类型凭据、构造适配器的顺序。桌面和Typora保留各自错误文案以及公开/私有目标边界；测试使用内存CredentialReader，不访问真实系统凭据库或云端。后续发布生命周期和仓储拆分仍单独验收，不把共享工厂等同于Rust服务重构全部完成。

现有验证分层：Node/Python本地纯函数与契约、云端Rust测试、原生Windows/UI、网站隔离浏览器、真实账号/G3验收。证据层级不能互相代替。完整协作及授权约束见根目录AGENTS.md。

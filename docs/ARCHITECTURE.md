# Architecture Decision — V0.1

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

桌面 UI、Typora CLI 与未来 Local API 不应各自实现发布策略。多云策略逐步收敛到 `crates/application::PublisherCore`：

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
